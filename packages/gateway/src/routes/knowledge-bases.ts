import { AppError, newId } from '@confer/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { knowledgeBases, knowledgeDocuments } from '../db/schema.js';
import { getEnv } from '../env.js';
import { chunkText } from '../lib/chunker.js';
import { ingestQueue } from '../lib/concurrency.js';
import { guessContentType, parseDocument } from '../lib/doc-parser.js';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { getUserLlmKeys, resolveEmbeddingKey } from '../lib/llm-keys.js';
import { parseLimit, parseOffset } from '../lib/pagination.js';
import { deleteByDocId, deleteByKbId, ensureCollection, upsertChunks } from '../lib/qdrant.js';
import { getObject, putObject, removeObject } from '../lib/storage.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const knowledgeBasesRoutes = new Hono<AppEnv>();

knowledgeBasesRoutes.use('/*', authMiddleware);

const createKbSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

async function getEmbeddingConfig(
  userId: string,
): Promise<{ apiKey: string; provider: EmbeddingProvider }> {
  const llmKeys = await getUserLlmKeys(userId);
  const config = await resolveEmbeddingKey(llmKeys, getEnv().ENCRYPTION_KEY);
  if (!config) {
    throw new AppError(
      'embedding_unavailable',
      'No embedding provider configured — please add an OpenAI, ZhipuAI (GLM), or Qwen API key in Settings',
      400,
    );
  }
  return config;
}

/** Loads a knowledge base, rejecting ids that belong to another user. */
async function requireKb(
  kbId: string,
  userId: string,
): Promise<typeof knowledgeBases.$inferSelect> {
  const [kb] = await getDb()
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.user_id, userId)))
    .limit(1);

  if (!kb) throw new AppError('not_found', 'Knowledge base not found', 404);
  return kb;
}

/** Loads a document, rejecting ids that belong to another user. */
async function requireDocument(
  docId: string,
  userId: string,
): Promise<typeof knowledgeDocuments.$inferSelect> {
  const [doc] = await getDb()
    .select()
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, docId), eq(knowledgeDocuments.user_id, userId)))
    .limit(1);

  if (!doc) throw new AppError('not_found', 'Document not found', 404);
  return doc;
}

type IngestJob = {
  docId: string;
  kbId: string;
  kbName: string;
  userId: string;
  filename: string;
  contentType: string;
  buffer: ArrayBuffer;
};

/** Queues ingestion and marks the document failed if the pipeline throws. */
function submitIngestion(job: IngestJob, failureLabel: string): void {
  ingestQueue
    .submit(() => ingestDocument(job))
    .catch((err) => {
      console.error(`${failureLabel} for doc ${job.docId}:`, err);
      getDb()
        .update(knowledgeDocuments)
        .set({ status: 'failed' })
        .where(eq(knowledgeDocuments.id, job.docId))
        .catch(() => {});
    });
}

// --- Knowledge Base CRUD ---

knowledgeBasesRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const rows = await db.select().from(knowledgeBases).where(eq(knowledgeBases.user_id, user.sub));
  return c.json({ knowledge_bases: rows });
});

knowledgeBasesRoutes.post('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = createKbSchema.parse(await c.req.json());

  const [row] = await db
    .insert(knowledgeBases)
    .values({ id: newId(), user_id: user.sub, name: body.name, description: body.description })
    .returning();

  return c.json({ knowledge_base: row }, 201);
});

knowledgeBasesRoutes.delete('/:kbId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const kbId = c.req.param('kbId');

  await requireKb(kbId, user.sub);

  await deleteByKbId(kbId).catch(() => {});
  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.kb_id, kbId));
  await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kbId));

  return c.json({ ok: true });
});

// --- Document management ---

knowledgeBasesRoutes.get('/:kbId/documents', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const kbId = c.req.param('kbId');
  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const offset = parseOffset(c.req.query('offset'));

  await requireKb(kbId, user.sub);

  // A knowledge base is an upload target, so this is the one list here that
  // genuinely grows without bound. Ordered by id (ULID) for a stable,
  // newest-first window that offset paging can walk without gaps.
  const inKb = eq(knowledgeDocuments.kb_id, kbId);
  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(inKb)
    .orderBy(desc(knowledgeDocuments.id))
    .limit(limit)
    .offset(offset);

  const [totals] = await db.select({ value: count() }).from(knowledgeDocuments).where(inKb);

  return c.json({ documents: docs, total: totals?.value ?? 0 });
});

knowledgeBasesRoutes.post('/:kbId/documents', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const kbId = c.req.param('kbId');

  const kb = await requireKb(kbId, user.sub);

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) throw new AppError('bad_request', 'No file uploaded', 400);

  if (file.size > 10 * 1024 * 1024) {
    throw new AppError('bad_request', 'File too large (max 10MB)', 400);
  }

  const contentType = file.type || guessContentType(file.name);
  const buffer = await file.arrayBuffer();

  const docId = newId();
  const storageKey = `${user.sub}/${kbId}/${docId}`;

  await putObject(storageKey, Buffer.from(buffer), contentType);

  const [docRow] = await db
    .insert(knowledgeDocuments)
    .values({
      id: docId,
      kb_id: kbId,
      user_id: user.sub,
      filename: file.name,
      content_type: contentType,
      size_bytes: file.size,
      status: 'processing',
      storage_key: storageKey,
    })
    .returning();

  // Run ingestion pipeline (async, respond first). The queue bounds how many
  // documents ingest at once so concurrent uploads apply backpressure.
  submitIngestion(
    {
      docId,
      kbId,
      kbName: kb.name,
      userId: user.sub,
      filename: file.name,
      contentType,
      buffer,
    },
    'Ingestion failed',
  );

  return c.json({ document: docRow }, 201);
});

knowledgeBasesRoutes.delete('/:kbId/documents/:docId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const { docId } = c.req.param();

  const doc = await requireDocument(docId, user.sub);

  await deleteByDocId(docId).catch(() => {});
  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId));
  if (doc.storage_key) await removeObject(doc.storage_key).catch(() => {});

  return c.json({ ok: true });
});

knowledgeBasesRoutes.post('/:kbId/documents/:docId/retry', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const { kbId, docId } = c.req.param();

  const doc = await requireDocument(docId, user.sub);
  if (!doc.storage_key)
    throw new AppError('bad_request', 'Original file not available for retry', 400);
  if (doc.status === 'processing')
    throw new AppError('bad_request', 'Document is already processing', 400);

  const kb = await requireKb(kbId, user.sub);

  const [updated] = await db
    .update(knowledgeDocuments)
    .set({ status: 'processing', chunk_count: 0 })
    .where(eq(knowledgeDocuments.id, docId))
    .returning();

  const buffer = await getObject(doc.storage_key);
  const contentType = doc.content_type ?? guessContentType(doc.filename);

  // getObject returns a Buffer that may be a pooled view; slice to its exact bytes
  const fileBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

  // Log rather than swallow: a failed cleanup leaves stale chunks that the
  // re-ingest below would duplicate, silently degrading retrieval quality.
  await deleteByDocId(docId).catch((err) =>
    console.error(`Retry cleanup failed for doc ${docId}:`, err),
  );
  submitIngestion(
    {
      docId,
      kbId,
      kbName: kb.name,
      userId: user.sub,
      filename: doc.filename,
      contentType,
      buffer: fileBuffer,
    },
    'Retry ingestion failed',
  );

  return c.json({ document: updated });
});

async function ingestDocument(job: IngestJob): Promise<void> {
  const { docId, kbId, kbName, userId, filename, contentType, buffer } = job;
  const db = getDb();
  const { apiKey, provider } = await getEmbeddingConfig(userId);

  const text = await parseDocument(buffer, contentType);
  const chunks = chunkText(text, docId, filename, kbId, userId).map((c) => ({
    ...c,
    kb_name: kbName,
  }));

  if (chunks.length === 0) {
    await db
      .update(knowledgeDocuments)
      .set({ status: 'ready', chunk_count: 0 })
      .where(eq(knowledgeDocuments.id, docId));
    return;
  }

  await ensureCollection();
  const vectors = await embedTexts(
    chunks.map((c) => c.text),
    apiKey,
    provider,
  );
  const points = chunks.map((c, i) => ({ ...c, vector: vectors[i] as number[], provider }));
  await upsertChunks(points);

  await db
    .update(knowledgeDocuments)
    .set({ status: 'ready', chunk_count: chunks.length })
    .where(eq(knowledgeDocuments.id, docId));
}

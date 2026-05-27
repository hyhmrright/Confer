import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { knowledgeBases, knowledgeDocuments, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { AppError, newId, decrypt } from '@confer/shared';
import { parseDocument, guessContentType } from '../lib/doc-parser.js';
import { chunkText } from '../lib/chunker.js';
import { embedTexts, type EmbeddingProvider, EMBEDDING_PROVIDER_PRIORITY } from '../lib/embedding.js';
import { ensureCollection, upsertChunks, deleteByKbId, deleteByDocId } from '../lib/qdrant.js';
import { getEnv } from '../env.js';
import type { AppEnv } from '../types.js';

export const knowledgeBasesRoutes = new Hono<AppEnv>();

knowledgeBasesRoutes.use('/*', authMiddleware);

const createKbSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

async function getEmbeddingConfig(userId: string): Promise<{ apiKey: string; provider: EmbeddingProvider }> {
  const env = getEnv();
  const db = getDb();
  const [userRow] = await db
    .select({ llm_keys_json: users.llm_keys_json })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const llmKeys = (userRow?.llm_keys_json ?? {}) as Record<string, unknown>;

  for (const provider of EMBEDDING_PROVIDER_PRIORITY) {
    const encryptedKey = llmKeys[provider] as import('@confer/shared').EncryptedValue | undefined;
    if (!encryptedKey) continue;
    const result = await decrypt(encryptedKey, env.ENCRYPTION_KEY);
    if (result.ok) return { apiKey: result.value, provider };
  }

  throw new AppError('embedding_unavailable', 'No embedding provider configured — please add an OpenAI, ZhipuAI (GLM), or Qwen API key in Settings', 400);
}

// --- Knowledge Base CRUD ---

knowledgeBasesRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const rows = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.user_id, user.sub));
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

  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.user_id, user.sub)))
    .limit(1);

  if (!kb) throw new AppError('not_found', 'Knowledge base not found', 404);

  await deleteByKbId(kbId);
  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.kb_id, kbId));
  await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kbId));

  return c.json({ ok: true });
});

// --- Document management ---

knowledgeBasesRoutes.get('/:kbId/documents', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const kbId = c.req.param('kbId');

  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.user_id, user.sub)))
    .limit(1);
  if (!kb) throw new AppError('not_found', 'Knowledge base not found', 404);

  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.kb_id, kbId));

  return c.json({ documents: docs });
});

knowledgeBasesRoutes.post('/:kbId/documents', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const kbId = c.req.param('kbId');

  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.user_id, user.sub)))
    .limit(1);
  if (!kb) throw new AppError('not_found', 'Knowledge base not found', 404);

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) throw new AppError('bad_request', 'No file uploaded', 400);

  if (file.size > 10 * 1024 * 1024) {
    throw new AppError('bad_request', 'File too large (max 10MB)', 400);
  }

  const contentType = file.type || guessContentType(file.name);
  const buffer = await file.arrayBuffer();

  const docId = newId();
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
    })
    .returning();

  // Run ingestion pipeline (async, respond first)
  ingestDocument(docId, kbId, kb.name, user.sub, file.name, contentType, buffer).catch((err) => {
    console.error(`Ingestion failed for doc ${docId}:`, err);
    db.update(knowledgeDocuments)
      .set({ status: 'failed' })
      .where(eq(knowledgeDocuments.id, docId))
      .catch(() => {});
  });

  return c.json({ document: docRow }, 201);
});

knowledgeBasesRoutes.delete('/:kbId/documents/:docId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const { docId } = c.req.param();

  const [doc] = await db
    .select()
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, docId), eq(knowledgeDocuments.user_id, user.sub)))
    .limit(1);
  if (!doc) throw new AppError('not_found', 'Document not found', 404);

  await deleteByDocId(docId);
  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId));

  return c.json({ ok: true });
});

async function ingestDocument(
  docId: string,
  kbId: string,
  kbName: string,
  userId: string,
  filename: string,
  contentType: string,
  buffer: ArrayBuffer,
): Promise<void> {
  const db = getDb();
  const { apiKey, provider } = await getEmbeddingConfig(userId);

  const text = await parseDocument(buffer, contentType);
  const chunks = chunkText(text, docId, filename, kbId, userId).map((c) => ({ ...c, kb_name: kbName }));

  if (chunks.length === 0) {
    await db.update(knowledgeDocuments)
      .set({ status: 'ready', chunk_count: 0 })
      .where(eq(knowledgeDocuments.id, docId));
    return;
  }

  await ensureCollection();
  const vectors = await embedTexts(chunks.map((c) => c.text), apiKey, provider);
  const points = chunks.map((c, i) => ({ ...c, vector: vectors[i] as number[] }));
  await upsertChunks(points);

  await db.update(knowledgeDocuments)
    .set({ status: 'ready', chunk_count: chunks.length })
    .where(eq(knowledgeDocuments.id, docId));
}

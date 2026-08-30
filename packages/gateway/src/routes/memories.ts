import { AppError, newId } from '@confer/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { getEnv } from '../env.js';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { getUserLlmKeys, resolveEmbeddingKey } from '../lib/llm-keys.js';
import { asMemorySource, deleteMemory, upsertMemory } from '../lib/memory-store.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const memoriesRoutes = new Hono<AppEnv>();

memoriesRoutes.use('/*', authMiddleware);

// A memory is only reachable through vector search — the agent recalls from
// Qdrant, never from this table. So writing the row without indexing it does
// not create a memory the agent uses less often, it creates one it can never
// see at all, listed in the UI as though it worked. Both write paths here now
// index, and refuse rather than store something inert: same contract as the
// knowledge base, which already rejects a document it cannot embed.
async function embedMemory(
  userId: string,
  text: string,
): Promise<{ vector: number[]; provider: EmbeddingProvider }> {
  const config = await resolveEmbeddingKey(await getUserLlmKeys(userId), getEnv().ENCRYPTION_KEY);
  if (!config) {
    throw new AppError(
      'embedding_unavailable',
      'No embedding provider configured — please add an OpenAI, ZhipuAI (GLM), or Qwen API key in Settings',
      400,
    );
  }
  const [vector] = await embedTexts([text], config.apiKey, config.provider);
  if (!vector) throw new AppError('embedding_failed', 'Could not embed this memory', 502);
  return { vector, provider: config.provider };
}

const createSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

memoriesRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.user_id, user.sub))
    .orderBy(desc(agentMemories.pinned), desc(agentMemories.updated_at))
    .limit(100);

  return c.json({ memories: rows });
});

memoriesRoutes.post('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = createSchema.parse(await c.req.json());

  // Embed before writing anything, so a missing key fails the request instead
  // of leaving a row behind.
  const { vector, provider } = await embedMemory(user.sub, body.content);

  const memoryId = newId();
  const [row] = await db
    .insert(agentMemories)
    .values({
      id: memoryId,
      user_id: user.sub,
      title: body.title,
      content: body.content,
      tags: body.tags ?? [],
      pinned: body.pinned ?? false,
    })
    .returning();

  try {
    await upsertMemory({
      memoryId,
      userId: user.sub,
      text: body.content,
      vector,
      provider,
      source: 'manual',
    });
  } catch (err) {
    // Undo the row rather than keep an unrecallable one. The reverse orphan (a
    // vector with no row) would be worse: recall reads its text from the
    // payload, so it would answer from a memory the owner cannot see or delete.
    await db.delete(agentMemories).where(eq(agentMemories.id, memoryId));
    throw err;
  }

  return c.json({ memory: row }, 201);
});

memoriesRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const id = c.req.param('id');
  const body = updateSchema.parse(await c.req.json());
  const owned = and(eq(agentMemories.id, id), eq(agentMemories.user_id, user.sub));

  // Editing the text without re-indexing leaves recall answering from the old
  // wording — the one the owner just corrected. Re-index first: if the row
  // update then fails the request errors and they retry, whereas the reverse
  // order fails silently on an otherwise successful edit.
  if (body.content !== undefined) {
    const [existing] = await db
      .select({ id: agentMemories.id, source: agentMemories.source })
      .from(agentMemories)
      .where(owned);
    if (!existing) throw new AppError('not_found', 'Memory not found', 404);

    const { vector, provider } = await embedMemory(user.sub, body.content);
    // Carry the row's own source across: an edit rewrites the payload wholesale,
    // and stamping 'manual' here would relabel an auto- or peer-derived memory
    // in Qdrant while the row it mirrors still says otherwise.
    await upsertMemory({
      memoryId: id,
      userId: user.sub,
      text: body.content,
      vector,
      provider,
      source: asMemorySource(existing.source) ?? 'manual',
    });
  }

  const [row] = await db
    .update(agentMemories)
    .set({ ...body, updated_at: new Date() })
    .where(owned)
    .returning();

  if (!row) throw new AppError('not_found', 'Memory not found', 404);
  return c.json({ memory: row });
});

memoriesRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const id = c.req.param('id');

  const deleted = await db
    .delete(agentMemories)
    .where(and(eq(agentMemories.id, id), eq(agentMemories.user_id, user.sub)))
    .returning({ id: agentMemories.id });

  if (!deleted.length) throw new AppError('not_found', 'Memory not found', 404);

  // Also drop the Qdrant vector so a deleted memory can't be recalled. Best-effort:
  // a Qdrant hiccup must not fail an otherwise-successful delete (the orphaned
  // vector is filtered by user_id and can be reconciled later).
  try {
    await deleteMemory(user.sub, id);
  } catch (err) {
    console.error(`Failed to delete Qdrant vector for memory ${id}:`, err);
  }

  return c.json({ ok: true });
});

import { AppError, newId, projectMemoryWriteSchema } from '@confer/shared';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { peerAgents, peerContacts, projectMemory } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const projectsRoutes = new Hono<AppEnv>();

projectsRoutes.use('/*', authMiddleware);

// project_id is a path segment that ends up in a varchar(255). Validate it
// explicitly to reject path-injection / junk before it reaches the query, and to
// keep the stored value within the column width.
const projectIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9._\-/]+$/);

function parseProjectId(raw: string): string {
  const parsed = projectIdSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid_project_id', 'Invalid project_id', 400);
  return parsed.data;
}

// Only peers the user has connected to may have memory written for them. Reads
// are scoped to user.sub so they can't see another user's rows regardless.
async function assertContact(userId: string, peerId: string): Promise<void> {
  const db = getDb();
  const [contact] = await db
    .select()
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, userId), eq(peerContacts.peer_id, peerId)))
    .limit(1);
  if (!contact) throw new AppError('not_a_contact', 'Peer is not a contact', 403);
}

// List the peers that have any memory under this project, with the peer's live
// name/did joined from peer_agents. Empty project => empty array (not an error).
projectsRoutes.get('/:projectId/peers', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const projectId = parseProjectId(c.req.param('projectId'));

  const rows = await db
    .select({
      peer_id: projectMemory.peer_id,
      did: peerAgents.did,
      name: peerAgents.name,
      version: projectMemory.version,
      updated_at: projectMemory.updated_at,
    })
    .from(projectMemory)
    .innerJoin(peerAgents, eq(projectMemory.peer_id, peerAgents.id))
    .where(and(eq(projectMemory.user_id, user.sub), eq(projectMemory.project_id, projectId)));

  return c.json({ peers: rows });
});

// Read a section. A missing (project, peer) row is the normal "no memory yet"
// state for a read, so return 200 + empty string + version 0 rather than 404.
async function readSection(userId: string, projectId: string, peerId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectMemory)
    .where(
      and(
        eq(projectMemory.user_id, userId),
        eq(projectMemory.project_id, projectId),
        eq(projectMemory.peer_id, peerId),
      ),
    )
    .limit(1);
  return row;
}

projectsRoutes.get('/:projectId/peers/:peerId/facts', async (c) => {
  const user = c.get('user');
  const projectId = parseProjectId(c.req.param('projectId'));
  const peerId = c.req.param('peerId');
  const row = await readSection(user.sub, projectId, peerId);
  return c.json({
    facts_md: row?.facts_md ?? '',
    version: row?.version ?? 0,
    updated_at: row?.updated_at ?? null,
  });
});

projectsRoutes.get('/:projectId/peers/:peerId/decisions', async (c) => {
  const user = c.get('user');
  const projectId = parseProjectId(c.req.param('projectId'));
  const peerId = c.req.param('peerId');
  const row = await readSection(user.sub, projectId, peerId);
  return c.json({
    decisions_md: row?.decisions_md ?? '',
    version: row?.version ?? 0,
    updated_at: row?.updated_at ?? null,
  });
});

projectsRoutes.put('/:projectId/peers/:peerId/facts', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const projectId = parseProjectId(c.req.param('projectId'));
  const peerId = c.req.param('peerId');
  const body = projectMemoryWriteSchema.parse(await c.req.json());

  await assertContact(user.sub, peerId);

  // Set only facts_md on conflict so a facts write can never clear decisions_md.
  const [row] = await db
    .insert(projectMemory)
    .values({
      id: newId(),
      user_id: user.sub,
      project_id: projectId,
      peer_id: peerId,
      facts_md: body.facts_md,
      version: 1,
    })
    .onConflictDoUpdate({
      target: [projectMemory.user_id, projectMemory.project_id, projectMemory.peer_id],
      set: {
        facts_md: body.facts_md,
        version: sql`${projectMemory.version} + 1`,
        updated_at: new Date(),
      },
    })
    .returning();

  return c.json({
    facts_md: row?.facts_md ?? '',
    version: row?.version ?? 1,
    updated_at: row?.updated_at ?? null,
  });
});

projectsRoutes.put('/:projectId/peers/:peerId/decisions', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const projectId = parseProjectId(c.req.param('projectId'));
  const peerId = c.req.param('peerId');
  const body = projectMemoryWriteSchema.parse(await c.req.json());

  await assertContact(user.sub, peerId);

  // Set only decisions_md on conflict so a decisions write can never clear facts_md.
  const [row] = await db
    .insert(projectMemory)
    .values({
      id: newId(),
      user_id: user.sub,
      project_id: projectId,
      peer_id: peerId,
      decisions_md: body.decisions_md,
      version: 1,
    })
    .onConflictDoUpdate({
      target: [projectMemory.user_id, projectMemory.project_id, projectMemory.peer_id],
      set: {
        decisions_md: body.decisions_md,
        version: sql`${projectMemory.version} + 1`,
        updated_at: new Date(),
      },
    })
    .returning();

  return c.json({
    decisions_md: row?.decisions_md ?? '',
    version: row?.version ?? 1,
    updated_at: row?.updated_at ?? null,
  });
});

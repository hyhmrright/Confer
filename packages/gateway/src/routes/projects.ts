import {
  AppError,
  newId,
  projectDecisionsWriteSchema,
  projectFactsWriteSchema,
} from '@confer/shared';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { peerAgents, projectMemory } from '../db/schema.js';
import { assertIsContact } from '../lib/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const projectsRoutes = new Hono<AppEnv>();

projectsRoutes.use('/*', authMiddleware);

// project_id is a single path segment that ends up in a varchar(255). Validate it
// explicitly to reject path-injection / junk before it reaches the query, and to
// keep the stored value within the column width. Slash is intentionally excluded:
// the MCP client encodeURIComponent()s the id, and a %2F is decoded back to a path
// separator before routing, so a slashed id would never match `/:projectId/...`.
const projectIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9._-]+$/);

function parseProjectId(raw: string): string {
  const parsed = projectIdSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid_project_id', 'Invalid project_id', 400);
  return parsed.data;
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

// facts and decisions are two columns of one row, written independently: each
// write sets only its own column on conflict, so a facts write can never clear
// decisions_md and vice versa. Everything else about the two is identical.
const SECTIONS = [
  {
    path: 'facts',
    column: 'facts_md',
    parse: (body: unknown) => projectFactsWriteSchema.parse(body).facts_md,
    patch: (md: string) => ({ facts_md: md }),
  },
  {
    path: 'decisions',
    column: 'decisions_md',
    parse: (body: unknown) => projectDecisionsWriteSchema.parse(body).decisions_md,
    patch: (md: string) => ({ decisions_md: md }),
  },
] as const;

for (const { path, column, parse, patch } of SECTIONS) {
  projectsRoutes.get(`/:projectId/peers/:peerId/${path}`, async (c) => {
    const user = c.get('user');
    const projectId = parseProjectId(c.req.param('projectId'));
    const peerId = c.req.param('peerId');
    const row = await readSection(user.sub, projectId, peerId);
    return c.json({
      [column]: row?.[column] ?? '',
      version: row?.version ?? 0,
      updated_at: row?.updated_at ?? null,
    });
  });

  projectsRoutes.put(`/:projectId/peers/:peerId/${path}`, async (c) => {
    const user = c.get('user');
    const db = getDb();
    const projectId = parseProjectId(c.req.param('projectId'));
    const peerId = c.req.param('peerId');
    const md = parse(await c.req.json());

    await assertIsContact(user.sub, peerId);

    const [row] = await db
      .insert(projectMemory)
      .values({
        id: newId(),
        user_id: user.sub,
        project_id: projectId,
        peer_id: peerId,
        ...patch(md),
        version: 1,
      })
      .onConflictDoUpdate({
        target: [projectMemory.user_id, projectMemory.project_id, projectMemory.peer_id],
        set: {
          ...patch(md),
          version: sql`${projectMemory.version} + 1`,
          updated_at: new Date(),
        },
      })
      .returning();

    return c.json({
      [column]: row?.[column] ?? '',
      version: row?.version ?? 1,
      updated_at: row?.updated_at ?? null,
    });
  });
}

// One snapshot/version for both files. Sync must never combine sections read on
// opposite sides of a write, or overwrite a newer server edit.
projectsRoutes.get('/:projectId/peers/:peerId/memory', async (c) => {
  const row = await readSection(
    c.get('user').sub,
    parseProjectId(c.req.param('projectId')),
    c.req.param('peerId'),
  );
  return c.json({
    facts_md: row?.facts_md ?? '',
    decisions_md: row?.decisions_md ?? '',
    version: row?.version ?? 0,
  });
});
projectsRoutes.put('/:projectId/peers/:peerId/memory', async (c) => {
  const body = z
    .object({
      facts_md: z.string().max(200000),
      decisions_md: z.string().max(200000),
      expected_version: z.number().int().min(0),
    })
    .parse(await c.req.json());
  const userId = c.get('user').sub;
  const projectId = parseProjectId(c.req.param('projectId'));
  const peerId = c.req.param('peerId');
  await assertIsContact(userId, peerId);
  const owned = and(
    eq(projectMemory.user_id, userId),
    eq(projectMemory.project_id, projectId),
    eq(projectMemory.peer_id, peerId),
  );
  const patch = {
    facts_md: body.facts_md,
    decisions_md: body.decisions_md,
    updated_at: new Date(),
  };
  const rows =
    body.expected_version === 0
      ? await getDb()
          .insert(projectMemory)
          .values({
            id: newId(),
            user_id: userId,
            project_id: projectId,
            peer_id: peerId,
            ...patch,
            version: 1,
          })
          .onConflictDoNothing()
          .returning()
      : await getDb()
          .update(projectMemory)
          .set({ ...patch, version: body.expected_version + 1 })
          .where(and(owned, eq(projectMemory.version, body.expected_version)))
          .returning();
  if (!rows.length)
    throw new AppError('sync_conflict', 'Project memory changed; pull and reconcile first', 409);
  return c.json({
    facts_md: rows[0]?.facts_md,
    decisions_md: rows[0]?.decisions_md,
    version: rows[0]?.version,
  });
});

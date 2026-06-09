import {
  AppError,
  PROBE_QUESTION_MAX,
  askPersonRequestSchema,
  fillProbeRequestSchema,
  newId,
} from '@confer/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import {
  conversationParticipants,
  conversations,
  messages,
  peerAgents,
  probeAsks,
} from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

// Idea C — MCP↔A2A bridge probe. A Wizard-of-Oz REST surface (Bearer auth, never
// touches /a2a/v1/* and never signs A2A messages):
//   POST /api/v1/probe/ask-person   — record the ask + open a placeholder thread
//   GET  /api/v1/probe/ask-person/pending — Wizard pulls asks awaiting a fill
//   POST /api/v1/probe/ask-person/:id/fill — Wizard relays the human's answer
// The answer is written as a peer_agent message into the placeholder conversation
// so the host retrieves it through the existing consult reply path (`check_reply`).

export const probeRoutes = new Hono<AppEnv>();
probeRoutes.use('/*', authMiddleware);

// A single synthetic relay peer stands in as the placeholder conversation's
// peer_agent participant. It exists only so the existing consult reply endpoint
// (which correlates replies with a peer participant) can return the Wizard's
// fill. It has no real DID endpoint and is never contacted over A2A.
const RELAY_DID = 'did:web:localhost:probe-wizard-relay';

async function getOrCreateRelayPeerId(): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: peerAgents.id })
    .from(peerAgents)
    .where(eq(peerAgents.did, RELAY_DID))
    .limit(1);
  if (existing) return existing.id;

  const id = newId();
  const [row] = await db
    .insert(peerAgents)
    .values({
      id,
      did: RELAY_DID,
      name: 'Probe Wizard relay',
      // Non-routable: the probe never delivers over A2A, this is a placeholder.
      endpoint: 'about:blank',
      public_key_json: {},
      agent_facts_json: {},
    })
    .onConflictDoNothing()
    .returning({ id: peerAgents.id });
  if (row) return row.id;

  // Lost the create race: read back the winner's row.
  const [winner] = await db
    .select({ id: peerAgents.id })
    .from(peerAgents)
    .where(eq(peerAgents.did, RELAY_DID))
    .limit(1);
  if (!winner) throw new AppError('relay_unavailable', 'Probe relay peer unavailable', 500);
  return winner.id;
}

// Record one ask and open its placeholder conversation. The question is stored
// (verification needs it) but truncated and never logged. Returns the ask and
// conversation ids plus a pending status — the call is async, never blocking.
probeRoutes.post('/ask-person', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = askPersonRequestSchema.parse(await c.req.json());

  // Defense in depth: the schema caps length, but truncate again so an oversized
  // value can never reach the column even if the schema changes.
  const question = body.question.slice(0, PROBE_QUESTION_MAX);

  const relayPeerId = await getOrCreateRelayPeerId();
  const convId = newId();
  const askId = newId();

  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({
      id: convId,
      type: 'probe',
      created_by: user.sub,
    });
    await tx.insert(conversationParticipants).values([
      {
        id: newId(),
        conversation_id: convId,
        participant_type: 'user',
        user_id: user.sub,
        role: 'owner',
      },
      {
        id: newId(),
        conversation_id: convId,
        participant_type: 'peer_agent',
        peer_id: relayPeerId,
        role: 'member',
      },
    ]);
    // The asker's question lands as a user message so the placeholder thread reads
    // as a normal conversation; the Wizard's answer follows as the peer reply.
    await tx.insert(messages).values({
      id: newId(),
      conversation_id: convId,
      sender_type: 'user',
      sender_id: user.sub,
      content_type: 'text',
      content: question,
    });
    await tx.insert(probeAsks).values({
      id: askId,
      asker_user_id: user.sub,
      person: body.person,
      question,
      conversation_id: convId,
      had_slack_dm_alt: body.had_slack_dm_alt ?? false,
      prompted: body.prompted ?? false,
    });
  });

  return c.json({ ask_id: askId, conversation_id: convId, status: 'pending' }, 201);
});

// Wizard pulls asks that have not been filled yet. Scoped to the caller (the
// single shared probe account), ordered oldest-first so the queue drains in
// arrival order.
probeRoutes.get('/ask-person/pending', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select({
      id: probeAsks.id,
      person: probeAsks.person,
      question: probeAsks.question,
      conversation_id: probeAsks.conversation_id,
      had_slack_dm_alt: probeAsks.had_slack_dm_alt,
      prompted: probeAsks.prompted,
      created_at: probeAsks.created_at,
    })
    .from(probeAsks)
    .where(and(eq(probeAsks.asker_user_id, user.sub), isNull(probeAsks.filled_at)))
    .orderBy(probeAsks.created_at);

  return c.json({ asks: rows });
});

// Wizard relays the human's answer: write it as the peer reply into the
// placeholder conversation (so the host's check_reply returns it) and stamp
// filled_at plus the audit annotations.
probeRoutes.post('/ask-person/:id/fill', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const askId = c.req.param('id');
  const body = fillProbeRequestSchema.parse(await c.req.json());

  const [ask] = await db
    .select()
    .from(probeAsks)
    .where(and(eq(probeAsks.id, askId), eq(probeAsks.asker_user_id, user.sub)))
    .limit(1);
  if (!ask) throw new AppError('not_found', 'Probe ask not found', 404);
  if (ask.filled_at) throw new AppError('already_filled', 'Probe ask already filled', 409);
  if (!ask.conversation_id) {
    throw new AppError('no_conversation', 'Probe ask has no conversation', 409);
  }
  const conversationId = ask.conversation_id;

  // The reply must be attributed to the conversation's peer_agent participant so
  // the consult reply endpoint can correlate it.
  const [peerParticipant] = await db
    .select({ peer_id: conversationParticipants.peer_id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, conversationId),
        eq(conversationParticipants.participant_type, 'peer_agent'),
      ),
    )
    .limit(1);
  if (!peerParticipant?.peer_id) {
    throw new AppError('no_relay', 'Probe conversation missing relay participant', 409);
  }
  const relayPeerId = peerParticipant.peer_id;

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: newId(),
      conversation_id: conversationId,
      sender_type: 'peer_agent',
      sender_id: relayPeerId,
      content_type: 'text',
      content: body.answer,
    });
    await tx
      .update(probeAsks)
      .set({
        filled_at: new Date(),
        could_self_answer: body.could_self_answer ?? null,
        is_founder_test: body.is_founder_test ?? false,
      })
      .where(eq(probeAsks.id, askId));
    await tx
      .update(conversations)
      .set({ updated_at: new Date() })
      .where(eq(conversations.id, conversationId));
  });

  return c.json({ ok: true });
});

// Recent asks for this account (audit/diagnostics). Returns instrumentation
// fields but is read-only; the question text is included because the surface is
// owner-scoped and never logged.
probeRoutes.get('/ask-person', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select()
    .from(probeAsks)
    .where(eq(probeAsks.asker_user_id, user.sub))
    .orderBy(desc(probeAsks.created_at))
    .limit(100);

  return c.json({ asks: rows });
});

# A2A 咨询能力(Gateway / Layer 1)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 gateway 补齐"用户主动发起的 A2A 咨询"能力 —— 向已是联系人的 peer agent 发问、投递、关联其异步回复、长轮询取回,供网页与后续 MCP 层共用。

**Architecture:** 新增 `/api/v1/consult/*` 认证路由,复用现有 `sendA2AMessage`(RFC 9421 签名,私钥不出 gateway)。peer 的回复经现有入站 `/a2a/v1/messages` 返回,按 `thread_id` 挂回同一 `type='consult'` 会话;入站处理器仅对 `message.type==='question'` 触发本地自动回复,对 `'answer'/'notification'` 只落库+广播,避免咨询回复触发死循环。

**Tech Stack:** Bun + Hono + Drizzle(PostgreSQL)、`@confer/identity`(签名)、`@confer/shared`(Zod/ULID)、`bun:test`(集成测试,真实 Postgres + mock 出站 fetch)。

**前置:** 本计划是两层方案的 Layer 1。Layer 2(`packages/mcp-a2a` MCP server)见后续计划 `2026-05-31-a2a-consult-mcp.md`,依赖本计划完成。

设计来源:`docs/superpowers/specs/2026-05-31-a2a-consult-mcp-design.md`

---

## 文件结构

| 文件 | 责任 | 动作 |
|------|------|------|
| `packages/gateway/src/db/schema.ts` | 给 `messages` 增 `delivery_status` 列 | 修改 |
| `packages/gateway/src/db/migrations/NNNN_*.sql` | 上述列的迁移(由 `db:generate` 生成) | 创建(生成) |
| `packages/shared/src/schemas.ts`(或既有 schema 文件) | `consultRequestSchema` Zod | 修改 |
| `packages/gateway/src/a2a/consult.ts` | 出站咨询投递逻辑(签名+发送+落库) | 创建 |
| `packages/gateway/src/routes/consult.ts` | `/api/v1/consult/*` 路由(发起/长轮询/历史) | 创建 |
| `packages/gateway/src/routes/a2a.ts` | 入站回调关联:非 question 跳过自动回复,落库+广播 | 修改 |
| `packages/gateway/src/app.ts` | 挂载 consult 路由 | 修改 |
| `packages/gateway/src/routes/consult.integration.test.ts` | 闭环集成测试 | 创建 |
| `docs/06-*.md`(A2A/API 对应文档) | 记录新端点 | 修改 |

---

## Task 1: 给 messages 增 delivery_status 列

**Files:**
- Modify: `packages/gateway/src/db/schema.ts`(`messages` 表定义内)
- Create(生成): `packages/gateway/src/db/migrations/NNNN_*.sql`

- [ ] **Step 1: 在 schema 的 `messages` 表加列**

在 `messages` pgTable 定义中,`via` 列之后加入:

```ts
    via: varchar('via', { length: 32 }),
    delivery_status: varchar('delivery_status', { length: 16 }),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
```

语义:出站消息 `'sent'` / `'failed'`;入站与本地消息保持 `null`。

- [ ] **Step 2: 生成迁移(切勿手写 SQL)**

Run: `bun run db:generate`
Expected: 在 `packages/gateway/src/db/migrations/` 生成一个新的 `NNNN_*.sql`,内容为 `ALTER TABLE "messages" ADD COLUMN "delivery_status" varchar(16);`,且 journal 自动更新。

- [ ] **Step 3: 应用迁移到本地/测试库**

Run: `bun run db:migrate`
Expected: 迁移成功,无报错。

- [ ] **Step 4: typecheck**

Run: `bun run typecheck`
Expected: 无 error。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/schema.ts packages/gateway/src/db/migrations
git commit -m "feat(gateway): add delivery_status column to messages"
```

---

## Task 2: consult 请求 Zod schema

**Files:**
- Modify: `packages/shared/src/schemas.ts`(与 `sendMessageRequestSchema` 同文件;若实际路径不同,放在导出 A2A/消息 schema 的同一文件)
- Test: 复用 Task 8 集成测试覆盖(此处仅类型契约)

- [ ] **Step 1: 写 schema**

在 `sendMessageRequestSchema` 附近新增并导出:

```ts
export const consultRequestSchema = z.object({
  question: z.string().min(1).max(8000),
  code_context: z.string().max(20000).optional(),
  language: z.string().max(8).optional(),
});
export type ConsultRequest = z.infer<typeof consultRequestSchema>;
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error(确认 `z` 已在该文件导入)。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat(shared): add consultRequestSchema"
```

---

## Task 3: 出站咨询投递逻辑

**Files:**
- Create: `packages/gateway/src/a2a/consult.ts`

职责:给定用户、peer、问题 → 取用户 active agent 与其签名密钥 → 复用 `sendA2AMessage` 投递 `type='question'` → 返回投递结果。不碰路由、不碰会话(会话由 Task 4 路由层管理)。

- [ ] **Step 1: 写实现**

```ts
import { sendA2AMessage } from './outbound.js';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, keypairs, peerAgents } from '../db/schema.js';
import { type Result, err, ok } from '@confer/shared';

export interface DeliverConsultInput {
  userId: string;
  peerId: string;
  conversationId: string;
  content: string;
}

export interface DeliverConsultOutput {
  fromDid: string;
  toDid: string;
}

/**
 * Sign and deliver a user-initiated consult question to a peer agent.
 * The signing key never leaves the gateway. thread_id carries the
 * conversation id so the peer's async answer can be correlated back.
 */
export async function deliverConsult(
  input: DeliverConsultInput,
): Promise<Result<DeliverConsultOutput, string>> {
  const db = getDb();

  const [agent] = await db.select().from(agents).where(eq(agents.user_id, input.userId)).limit(1);
  if (!agent) return err('no_agent: user has no agent to sign with');

  const [peer] = await db.select().from(peerAgents).where(eq(peerAgents.id, input.peerId)).limit(1);
  if (!peer) return err('peer_not_found');
  if (!peer.endpoint) return err('peer_no_endpoint');

  const [keypair] = await db
    .select()
    .from(keypairs)
    .where(
      and(
        eq(keypairs.owner_type, 'agent'),
        eq(keypairs.owner_id, agent.id),
        eq(keypairs.is_active, true),
      ),
    )
    .limit(1);
  if (!keypair) return err('no_signing_key');

  const result = await sendA2AMessage(
    peer.endpoint,
    {
      from: agent.did,
      to: peer.did,
      thread_id: input.conversationId,
      message: { type: 'question', content: input.content },
    },
    keypair.key_id,
    JSON.stringify(keypair.private_key_jwk_encrypted),
  );

  if (!result.ok) return err(result.error);
  return ok({ fromDid: agent.did, toDid: peer.did });
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。若 `keypairs` 字段名(`owner_type`/`owner_id`/`key_id`/`private_key_jwk_encrypted`/`is_active`)与 schema 不符,以 `packages/gateway/src/db/schema.ts` 实际定义为准修正(参照 `routes/a2a.ts:431-462` 的既有用法)。

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/a2a/consult.ts
git commit -m "feat(gateway): add outbound consult delivery helper"
```

---

## Task 4: 入站回调关联修复(防死循环)

**Files:**
- Modify: `packages/gateway/src/routes/a2a.ts`(POST `/messages` 处理器内 `setImmediate(...)` 自动回复触发处,约 318-335 行)

问题:咨询会话里 peer 的**回复**(`type='answer'`)会经入站 `/messages` 复用同一会话落库,但现有代码无条件触发 `processA2AMessage`(本地 LLM 自动回复),导致咨询变成无限对答。修复:仅对 `type==='question'` 触发自动回复;对 `'answer'/'notification'` 只落库(已落)+ 广播。

- [ ] **Step 1: 在落库之后、广播改造**

定位现有落库后的 `setImmediate(async () => { ... processA2AMessage ... })` 块,改为:

```ts
  const resolvedPeer = peer;
  const resolvedConvId = convId;

  // A peer's answer/notification to one of our outgoing consults must NOT
  // trigger our local auto-reply loop (that would ping-pong forever). Only
  // an inbound question is auto-answered. Either way the message is already
  // stored above; broadcast so web + consult long-poll wake up.
  broadcastToConversation(resolvedConvId, {
    type: 'message.new',
    data: {
      id: msgId,
      conversation_id: resolvedConvId,
      sender_type: 'peer_agent',
      sender_id: resolvedPeer.id,
      content: body.message.content,
      in_reply_to: body.thread_id,
    },
  });

  if (body.message.type === 'question') {
    setImmediate(async () => {
      try {
        await processA2AMessage({
          targetAgent,
          senderDid: body.from,
          senderPeer: resolvedPeer,
          messageContent: body.message.content,
          conversationId: resolvedConvId,
          inboundMessageId: msgId,
        });
      } catch (error) {
        console.error('A2A processing failed:', error);
      }
    });
  }
```

- [ ] **Step 2: 确认 import**

确认文件顶部已 `import { broadcastToConversation } from '../ws/handler.js';`;若未导入则补上。

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 无 error。

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/routes/a2a.ts
git commit -m "fix(gateway): only auto-reply to inbound questions, broadcast all"
```

---

## Task 5: consult 路由 — 发起咨询

**Files:**
- Create: `packages/gateway/src/routes/consult.ts`

- [ ] **Step 1: 写路由骨架 + POST 发起**

```ts
import { AppError, consultRequestSchema, newId } from '@confer/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { deliverConsult } from '../a2a/consult.js';
import { getDb } from '../db/connection.js';
import {
  conversationParticipants,
  conversations,
  messages,
  peerContacts,
} from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const consultRoutes = new Hono<AppEnv>();
consultRoutes.use('/*', authMiddleware);

// Find an existing consult conversation with this peer, or create one with the
// user + peer as participants. Returns the conversation id.
async function getOrCreateConsultConversation(userId: string, peerId: string): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversation_id, conversations.id),
    )
    .where(
      and(
        eq(conversations.type, 'consult'),
        eq(conversations.created_by, userId),
        eq(conversationParticipants.peer_id, peerId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const convId = newId();
  await db.insert(conversations).values({ id: convId, type: 'consult', created_by: userId });
  await db.insert(conversationParticipants).values([
    { id: newId(), conversation_id: convId, participant_type: 'user', user_id: userId, role: 'owner' },
    { id: newId(), conversation_id: convId, participant_type: 'peer_agent', peer_id: peerId, role: 'member' },
  ]);
  return convId;
}

consultRoutes.post('/:peerId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const peerId = c.req.param('peerId');
  const parsed = consultRequestSchema.parse(await c.req.json());

  // Only peers the user has connected to may be consulted.
  const [contact] = await db
    .select()
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, user.sub), eq(peerContacts.peer_id, peerId)))
    .limit(1);
  if (!contact) throw new AppError('not_a_contact', 'Peer is not a contact', 403);

  const convId = await getOrCreateConsultConversation(user.sub, peerId);

  const content = parsed.code_context
    ? `${parsed.question}\n\n---\n\`\`\`\n${parsed.code_context}\n\`\`\``
    : parsed.question;

  const msgId = newId();
  await db.insert(messages).values({
    id: msgId,
    conversation_id: convId,
    sender_type: 'user',
    sender_id: user.sub,
    content_type: 'text',
    content,
    language: parsed.language,
    via: 'a2a',
  });

  const result = await deliverConsult({
    userId: user.sub,
    peerId,
    conversationId: convId,
    content,
  });

  await db
    .update(messages)
    .set({
      delivery_status: result.ok ? 'sent' : 'failed',
      delivered_at: result.ok ? new Date() : null,
    })
    .where(eq(messages.id, msgId));

  await db
    .update(conversations)
    .set({ updated_at: new Date() })
    .where(eq(conversations.id, convId));

  if (!result.ok) {
    return c.json(
      { conversation_id: convId, message_id: msgId, status: 'failed', error: result.error },
      502,
    );
  }
  return c.json({ conversation_id: convId, message_id: msgId, status: 'sent' }, 201);
});
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/routes/consult.ts
git commit -m "feat(gateway): add POST /api/v1/consult/:peerId to initiate consult"
```

---

## Task 6: consult 路由 — 长轮询取回复 + 历史

**Files:**
- Modify: `packages/gateway/src/routes/consult.ts`

- [ ] **Step 1: 追加 reply 长轮询 与 history**

在 `consult.ts` 末尾(同一文件)追加:

```ts
// Verify the user owns the conversation before exposing its messages.
async function assertOwnsConversation(userId: string, convId: string): Promise<void> {
  const db = getDb();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, convId), eq(conversations.created_by, userId)))
    .limit(1);
  if (!conv) throw new AppError('not_found', 'Conversation not found', 404);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

consultRoutes.get('/:conversationId/reply', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('conversationId');
  await assertOwnsConversation(user.sub, convId);

  const afterId = c.req.query('after');
  const waitMs = Math.min(Number(c.req.query('wait') ?? '25'), 55) * 1000;

  // Cursor: only consider peer replies created strictly after the `after`
  // message (the user's question). Falls back to epoch when absent.
  let afterTs = new Date(0);
  if (afterId) {
    const [m] = await db.select().from(messages).where(eq(messages.id, afterId)).limit(1);
    if (m) afterTs = m.created_at;
  }

  const deadline = Date.now() + waitMs;
  for (;;) {
    const [reply] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversation_id, convId),
          eq(messages.sender_type, 'peer_agent'),
          gt(messages.created_at, afterTs),
        ),
      )
      .orderBy(asc(messages.created_at))
      .limit(1);

    if (reply) {
      return c.json({ status: 'answered', message: reply });
    }
    if (Date.now() >= deadline) {
      return c.json({ status: 'pending' });
    }
    await sleep(500);
  }
});

consultRoutes.get('/:conversationId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('conversationId');
  await assertOwnsConversation(user.sub, convId);

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, convId))
    .orderBy(asc(messages.created_at))
    .limit(200);

  return c.json({ conversation_id: convId, messages: rows });
});
```

注意:`/:conversationId/reply` 路由必须在 `/:conversationId` **之前**注册(Hono 按注册顺序匹配,更具体的先注册),上面顺序已正确。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/routes/consult.ts
git commit -m "feat(gateway): add consult reply long-poll and history endpoints"
```

---

## Task 7: 挂载路由

**Files:**
- Modify: `packages/gateway/src/app.ts`

- [ ] **Step 1: import + route**

在其它 `app.route('/api/v1/...', ...)` 附近加入:

```ts
import { consultRoutes } from './routes/consult.js';
// ...
app.route('/api/v1/consult', consultRoutes);
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/app.ts
git commit -m "feat(gateway): mount consult routes"
```

---

## Task 8: 闭环集成测试

**Files:**
- Create: `packages/gateway/src/routes/consult.integration.test.ts`

覆盖:发起咨询(mock 出站 fetch 成功)→ 落库 `sent` → 模拟 peer 经入站 `/a2a/v1/messages` 回 `type='answer'` → 长轮询拿到回复;以及 非联系人 403、投递失败 502、超时 pending、入站 answer 不触发自动回复。

- [ ] **Step 1: 写测试**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { generateEd25519KeyPair, signRequest } from '@confer/identity';
import { newId } from '@confer/shared';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { agents, keypairs, messages, peerAgents, peerContacts } from '../db/schema.js';
import { type SeededUser, get, headers, mockFetch, post, resetDb, seedUser } from '../test/helpers.js';

const CONSULT = '/api/v1/consult';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

// Seed the user's own agent + an active signing keypair so deliverConsult can sign.
async function seedOwnAgent(): Promise<string> {
  const db = getDb();
  const agentId = newId();
  const did = 'did:web:localhost:me';
  await db.insert(agents).values({ id: agentId, user_id: user.id, did, policies_json: {} });
  const kp = await generateEd25519KeyPair();
  await db.insert(keypairs).values({
    id: newId(),
    owner_type: 'agent',
    owner_id: agentId,
    key_id: `${did}#key-1`,
    public_key_jwk: kp.publicKeyJwk,
    private_key_jwk_encrypted: kp.privateKeyJwk,
    is_active: true,
  });
  return did;
}

// Seed a connected peer contact; returns peerId + did.
async function seedPeerContact(): Promise<{ peerId: string; did: string }> {
  const db = getDb();
  const peerId = newId();
  const did = 'did:web:peer.example';
  await db.insert(peerAgents).values({
    id: peerId,
    did,
    endpoint: 'https://peer.example/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  await db
    .insert(peerContacts)
    .values({ id: newId(), user_id: user.id, peer_id: peerId, added_via: 'manual' });
  return { peerId, did };
}

describe('consult', () => {
  test('requires authentication', async () => {
    expect((await get(CONSULT + '/x')).status).toBe(401);
  });

  test('rejects consulting a non-contact peer (403)', async () => {
    await seedOwnAgent();
    const res = await post(`${CONSULT}/${newId()}`, { token: user.token, body: { question: 'hi' } });
    expect(res.status).toBe(403);
  });

  test('initiates a consult, signs+delivers, stores message as sent', async () => {
    await seedOwnAgent();
    const { peerId } = await seedPeerContact();

    // Peer endpoint returns an A2A ack.
    const restore = mockFetch(async () =>
      new Response(JSON.stringify({ message_id: 'remote-1', thread_id: 't', stream_url: '/s' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await post(`${CONSULT}/${peerId}`, {
      token: user.token,
      body: { question: 'How do I rotate keys?' },
    });
    restore();

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('sent');

    const [stored] = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.id, body.message_id))
      .limit(1);
    expect(stored.delivery_status).toBe('sent');
    expect(stored.sender_type).toBe('user');
  });

  test('records delivery failure as failed (502)', async () => {
    await seedOwnAgent();
    const { peerId } = await seedPeerContact();
    const restore = mockFetch(async () => new Response('boom', { status: 500 }));

    const res = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'x' } });
    restore();

    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe('failed');
  });

  test('reply long-poll returns pending when no answer yet', async () => {
    await seedOwnAgent();
    const { peerId } = await seedPeerContact();
    const restore = mockFetch(async () =>
      new Response(JSON.stringify({ message_id: 'r', thread_id: 't', stream_url: '/s' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const sent = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'q' } });
    restore();
    const { conversation_id, message_id } = await sent.json();

    const res = await get(`${CONSULT}/${conversation_id}/reply?after=${message_id}&wait=1`, {
      token: user.token,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('pending');
  });

  test('peer answer via inbound /a2a/v1/messages is correlated and retrievable', async () => {
    const myDid = await seedOwnAgent();
    const { peerId, did: peerDid } = await seedPeerContact();
    const restore = mockFetch(async () =>
      new Response(JSON.stringify({ message_id: 'r', thread_id: 't', stream_url: '/s' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const sent = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'q' } });
    const { conversation_id, message_id } = await sent.json();
    restore();

    // Simulate the peer's signed async answer landing on our inbound endpoint,
    // carrying thread_id = conversation_id.
    const peerKp = await generateEd25519KeyPair();
    // The peer's signing key must be resolvable; reuse the seeded peer row by
    // setting its public key + a key_id-bearing DID. For the signature path,
    // align with a2a.integration.test.ts's signing helper.
    const inboundBody = JSON.stringify({
      from: peerDid,
      to: myDid,
      thread_id: conversation_id,
      message: { type: 'answer', content: 'Use AES-256-GCM and rotate quarterly.' },
    });
    const signed = await signRequest(
      new Request('http://localhost/a2a/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: inboundBody,
      }),
      await (async () => peerKp.privateKey)(),
      `${peerDid}#key-1`,
    );
    await app.request(signed);

    const res = await get(`${CONSULT}/${conversation_id}/reply?after=${message_id}&wait=2`, {
      token: user.token,
    });
    const body = await res.json();
    expect(body.status).toBe('answered');
    expect(body.message.content).toContain('AES-256-GCM');
  });
});
```

> 注:入站验签需要 peer 的公钥可解析(DID 解析被 mock)。实现此测试时,**照搬 `a2a.integration.test.ts` 里现成的 peer 签名 + DID 解析 mock 模式**(它已演示 `generateEd25519KeyPair` + `signRequest` + `clearDIDCache`/`publicKeyToMultibase` 的完整组合);上面的签名片段是占位形态,落地时替换为该文件验证过的写法,不要自创签名流程。

- [ ] **Step 2: 跑测试(首次需起测试栈)**

Run: `bun run test:setup`(若尚未起)然后 `bun run test packages/gateway/src/routes/consult.integration.test.ts`
Expected: 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/routes/consult.integration.test.ts
git commit -m "test(gateway): cover consult initiate/deliver/correlate/poll"
```

---

## Task 9: 文档同步(CLAUDE.md 硬规则)

**Files:**
- Modify: `docs/` 中描述 A2A / REST API 的对应文件(按 `docs/` 现有编号约定,A2A 端点文档文件)

- [ ] **Step 1: 记录新端点**

在对应 docs 文件追加 `/api/v1/consult/:peerId`(POST)、`/api/v1/consult/:conversationId/reply`(GET 长轮询)、`/api/v1/consult/:conversationId`(GET 历史)的用途、请求/响应、与"用户↔本地助手会话"的区别,以及 `message.type` 决定是否自动回复的契约。

- [ ] **Step 2: Commit**

```bash
git add docs
git commit -m "docs: document user-initiated A2A consult endpoints"
```

---

## 自审清单(已核对)

- **Spec 覆盖**:发现/认知由 Layer 2 承载(本计划提供历史与会话数据);咨询对话核心 = Task 5/6;异步回调关联 = Task 4;运维/安全中"投递失败/超时/非联系人 403"= Task 5/6/8,"PII 不记录完整 body" 由现有入站逻辑保证(本计划不新增日志);L3 权限复用现有 policy 引擎(Task 4 路径未改其语义)。
- **占位符**:Task 8 的入站签名片段已显式标注为"占位、落地时照搬现有测试模式",非隐性 TODO。
- **类型一致**:`deliverConsult` 的输入/输出、`consultRequestSchema`、`delivery_status` 列名在 Task 2/3/5/8 间一致;`sender_type='peer_agent'`(与入站既有写法一致,见 a2a.ts)。

## 风险

- `delivery_status` 加列影响 `messages` 全表,迁移为纯 `ADD COLUMN` 可空,安全。
- 长轮询 500ms 轮询为首版简化;高并发下可后续换 broadcast 订阅。
- `keypairs` 字段名以实际 schema 为准(Task 3 Step 2 已提示核对)。

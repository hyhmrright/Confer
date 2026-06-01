# A2A 咨询 MCP server(Layer 2)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `packages/mcp-a2a` —— 一个 stdio MCP server,把"咨询 peer A2A agent"暴露成 Claude Code 可调用的工具,底层调用 gateway 的 `/api/v1/consult/*`、`/contacts` 等认证 REST 接口。

**Architecture:** MCP server 以**一个配置的 Confer 用户**(env 提供用户名/密码)登录 gateway 取 JWT,缓存并在 401 时自动重登。所有工具 = gateway REST 的薄封装,私钥/签名仍由 gateway 完成。工具按四个能力域分组。

**Tech Stack:** `@modelcontextprotocol/sdk`(McpServer + StdioServerTransport)、Zod(工具入参 schema)、`bun:test`(单元测试,mock gateway fetch)。

**前置:** 依赖 Layer 1 计划 `2026-05-31-a2a-consult-gateway.md` 已落地(`/api/v1/consult/*` 可用)。设计来源:`docs/superpowers/specs/2026-05-31-a2a-consult-mcp-design.md`。

---

## 文件结构

| 文件 | 责任 | 动作 |
|------|------|------|
| `packages/mcp-a2a/package.json` | 包定义 + MCP SDK 依赖 | 创建 |
| `packages/mcp-a2a/tsconfig.json` | 沿用 monorepo tsconfig | 创建 |
| `packages/mcp-a2a/src/config.ts` | 读取/校验 env 配置 | 创建 |
| `packages/mcp-a2a/src/gateway-client.ts` | gateway HTTP 客户端(登录/重试/类型化调用) | 创建 |
| `packages/mcp-a2a/src/tools/discovery.ts` | 域1:list_agents / get_agent_capabilities / find_agents | 创建 |
| `packages/mcp-a2a/src/tools/consult.ts` | 域2:ask_agent / follow_up / get_conversation | 创建 |
| `packages/mcp-a2a/src/tools/advanced.ts` | 域3:ask_multiple / check_reply | 创建 |
| `packages/mcp-a2a/src/tools/ops.ts` | 域4:whoami | 创建 |
| `packages/mcp-a2a/src/server.ts` | 注册工具 + stdio transport,入口 | 创建 |
| `packages/mcp-a2a/src/gateway-client.test.ts` | 客户端单元测(mock fetch) | 创建 |
| `packages/mcp-a2a/src/tools/consult.test.ts` | 工具单元测(mock client) | 创建 |
| `.mcp.json` | Claude Code 连接配置 | 创建/修改 |
| `packages/mcp-a2a/README.md` | 启动/配置/冒烟说明 | 创建 |

---

## Task 1: 脚手架 + MCP SDK 依赖

**Files:**
- Create: `packages/mcp-a2a/package.json`, `packages/mcp-a2a/tsconfig.json`

- [ ] **Step 1: package.json**

```json
{
  "name": "@confer/mcp-a2a",
  "version": "0.1.0",
  "type": "module",
  "bin": { "confer-mcp-a2a": "./src/server.ts" },
  "exports": { ".": "./src/server.ts" },
  "scripts": {
    "dev": "bun run ./src/server.ts",
    "build": "bun build ./src/server.ts --outdir ./dist --target bun",
    "test": "bun test"
  },
  "dependencies": {
    "@confer/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "outDir": "./dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: 安装依赖**

Run: `bun install`
Expected: `@modelcontextprotocol/sdk` 解析成功,`packages/mcp-a2a` 纳入 workspace。

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-a2a/package.json packages/mcp-a2a/tsconfig.json package.json bun.lock
git commit -m "chore(mcp-a2a): scaffold package with MCP SDK"
```

---

## Task 2: 配置读取

**Files:**
- Create: `packages/mcp-a2a/src/config.ts`

- [ ] **Step 1: 写 config**

```ts
export interface McpConfig {
  gatewayUrl: string;
  username: string;
  password: string;
  defaultWaitSeconds: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const gatewayUrl = env.CONFER_GATEWAY_URL ?? 'http://localhost:3000';
  const username = env.CONFER_USERNAME;
  const password = env.CONFER_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'CONFER_USERNAME and CONFER_PASSWORD must be set for the MCP server to authenticate',
    );
  }
  const defaultWaitSeconds = Number(env.CONFER_CONSULT_WAIT ?? '25');
  return { gatewayUrl: gatewayUrl.replace(/\/$/, ''), username, password, defaultWaitSeconds };
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-a2a/src/config.ts
git commit -m "feat(mcp-a2a): add config loader"
```

---

## Task 3: gateway HTTP 客户端(登录 + 自动重登)

**Files:**
- Create: `packages/mcp-a2a/src/gateway-client.ts`
- Test: `packages/mcp-a2a/src/gateway-client.test.ts`

- [ ] **Step 1: 先写失败测试**

```ts
import { describe, expect, test } from 'bun:test';
import { GatewayClient } from './gateway-client.js';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init);
}

describe('GatewayClient', () => {
  test('logs in lazily and attaches the bearer token', async () => {
    const calls: string[] = [];
    const client = new GatewayClient(
      { gatewayUrl: 'http://gw', username: 'u', password: 'p', defaultWaitSeconds: 25 },
      fakeFetch((url, init) => {
        calls.push(url);
        if (url.endsWith('/api/v1/auth/login')) {
          return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
        }
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
        return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
      }),
    );

    const res = await client.get('/api/v1/contacts');
    expect(res).toEqual({ contacts: [] });
    expect(calls[0]).toContain('/auth/login');
  });

  test('re-logs in once on 401 then retries', async () => {
    let unauthorizedOnce = false;
    let logins = 0;
    const client = new GatewayClient(
      { gatewayUrl: 'http://gw', username: 'u', password: 'p', defaultWaitSeconds: 25 },
      fakeFetch((url) => {
        if (url.endsWith('/auth/login')) {
          logins++;
          return new Response(JSON.stringify({ access_token: `tok-${logins}` }), { status: 200 });
        }
        if (!unauthorizedOnce) {
          unauthorizedOnce = true;
          return new Response('nope', { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const res = await client.get('/api/v1/contacts');
    expect(res).toEqual({ ok: true });
    expect(logins).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test packages/mcp-a2a/src/gateway-client.test.ts`
Expected: FAIL（`GatewayClient` 未定义）。

- [ ] **Step 3: 写实现**

```ts
import type { McpConfig } from './config.js';

type FetchFn = typeof fetch;

export class GatewayClient {
  private token: string | null = null;
  constructor(
    private readonly cfg: McpConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async login(): Promise<void> {
    const res = await this.fetchFn(`${this.cfg.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });
    if (!res.ok) throw new Error(`gateway login failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string };
    this.token = body.access_token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) await this.login();
    const send = async () =>
      this.fetchFn(`${this.cfg.gatewayUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let res = await send();
    if (res.status === 401) {
      await this.login();
      res = await send();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`gateway ${method} ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  whoami(): string {
    return this.cfg.username;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun run test packages/mcp-a2a/src/gateway-client.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-a2a/src/gateway-client.ts packages/mcp-a2a/src/gateway-client.test.ts
git commit -m "feat(mcp-a2a): gateway client with lazy login and 401 retry"
```

---

## Task 4: 域1 发现工具

**Files:**
- Create: `packages/mcp-a2a/src/tools/discovery.ts`

工具实现为纯函数(接收 `GatewayClient`,返回结构化数据),由 Task 8 的 server.ts 注册成 MCP tool。这样工具逻辑可单测,与 MCP 传输解耦。

- [ ] **Step 1: 写实现**

```ts
import type { GatewayClient } from '../gateway-client.js';

export interface AgentSummary {
  peer_id: string;
  did: string;
  name: string | null;
  capabilities: unknown;
}

interface ContactsResponse {
  contacts: Array<{
    peer_id: string;
    did: string;
    name?: string | null;
    alias?: string | null;
    agent_facts_json?: unknown;
  }>;
}

export async function listAgents(client: GatewayClient): Promise<AgentSummary[]> {
  const { contacts } = await client.get<ContactsResponse>('/api/v1/contacts');
  return contacts.map((c) => ({
    peer_id: c.peer_id,
    did: c.did,
    name: c.alias ?? c.name ?? null,
    capabilities: c.agent_facts_json ?? null,
  }));
}

export async function getAgentCapabilities(
  client: GatewayClient,
  peerId: string,
): Promise<unknown> {
  const agents = await listAgents(client);
  const found = agents.find((a) => a.peer_id === peerId);
  if (!found) throw new Error(`peer ${peerId} is not a contact`);
  return found.capabilities;
}

export async function findAgents(
  client: GatewayClient,
  capability: string,
): Promise<AgentSummary[]> {
  const needle = capability.toLowerCase();
  const agents = await listAgents(client);
  return agents.filter((a) => JSON.stringify(a.capabilities ?? '').toLowerCase().includes(needle));
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。落地时核对 `/api/v1/contacts` 实际响应字段名(见 `packages/gateway/src/routes/contacts.ts` GET `/`),按需调整 `ContactsResponse`。

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-a2a/src/tools/discovery.ts
git commit -m "feat(mcp-a2a): discovery tools (list/get-capabilities/find)"
```

---

## Task 5: 域2 咨询工具

**Files:**
- Create: `packages/mcp-a2a/src/tools/consult.ts`
- Test: `packages/mcp-a2a/src/tools/consult.test.ts`

- [ ] **Step 1: 先写失败测试**

```ts
import { describe, expect, test } from 'bun:test';
import { askAgent } from './consult.js';

function clientStub(routes: Record<string, unknown>) {
  return {
    post: async (p: string) => routes[`POST ${p}`],
    get: async (p: string) => routes[`GET ${p.split('?')[0]}`],
    whoami: () => 'u',
  } as never;
}

describe('askAgent', () => {
  test('returns answer when reply arrives within wait', async () => {
    const client = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
      'GET /api/v1/consult/c1/reply': {
        status: 'answered',
        message: { content: 'use ULID' },
      },
    });
    const out = await askAgent(client, { peerId: 'peer1', question: 'id format?', waitSeconds: 5 });
    expect(out.status).toBe('answered');
    expect(out.answer).toBe('use ULID');
    expect(out.conversationId).toBe('c1');
  });

  test('returns pending ticket when no wait requested', async () => {
    const client = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
    });
    const out = await askAgent(client, { peerId: 'peer1', question: 'q', waitSeconds: 0 });
    expect(out.status).toBe('pending');
    expect(out.conversationId).toBe('c1');
    expect(out.messageId).toBe('m1');
  });

  test('surfaces delivery failure', async () => {
    const client = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'failed', error: 'peer_no_endpoint' },
    });
    const out = await askAgent(client, { peerId: 'peer1', question: 'q', waitSeconds: 5 });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('peer_no_endpoint');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test packages/mcp-a2a/src/tools/consult.test.ts`
Expected: FAIL（`askAgent` 未定义）。

- [ ] **Step 3: 写实现**

```ts
import type { GatewayClient } from '../gateway-client.js';

interface InitiateResponse {
  conversation_id: string;
  message_id: string;
  status: 'sent' | 'failed';
  error?: string;
}
interface ReplyResponse {
  status: 'answered' | 'pending';
  message?: { content: string | null };
}

export interface AskInput {
  peerId: string;
  question: string;
  codeContext?: string;
  language?: string;
  waitSeconds: number;
}

export interface AskResult {
  status: 'answered' | 'pending' | 'failed';
  conversationId: string;
  messageId: string;
  answer?: string;
  error?: string;
}

export async function askAgent(client: GatewayClient, input: AskInput): Promise<AskResult> {
  const initiated = await client.post<InitiateResponse>(`/api/v1/consult/${input.peerId}`, {
    question: input.question,
    code_context: input.codeContext,
    language: input.language,
  });

  if (initiated.status === 'failed') {
    return {
      status: 'failed',
      conversationId: initiated.conversation_id,
      messageId: initiated.message_id,
      error: initiated.error,
    };
  }

  if (input.waitSeconds <= 0) {
    return {
      status: 'pending',
      conversationId: initiated.conversation_id,
      messageId: initiated.message_id,
    };
  }

  const reply = await client.get<ReplyResponse>(
    `/api/v1/consult/${initiated.conversation_id}/reply?after=${initiated.message_id}&wait=${input.waitSeconds}`,
  );
  if (reply.status === 'answered') {
    return {
      status: 'answered',
      conversationId: initiated.conversation_id,
      messageId: initiated.message_id,
      answer: reply.message?.content ?? '',
    };
  }
  return {
    status: 'pending',
    conversationId: initiated.conversation_id,
    messageId: initiated.message_id,
  };
}

// Multi-turn follow-up reuses the per-peer consult thread (gateway reuses one
// conversation per peer), so it is the same operation keyed by peerId.
export const followUp = askAgent;

export async function getConversation(
  client: GatewayClient,
  conversationId: string,
): Promise<unknown> {
  return client.get(`/api/v1/consult/${conversationId}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun run test packages/mcp-a2a/src/tools/consult.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-a2a/src/tools/consult.ts packages/mcp-a2a/src/tools/consult.test.ts
git commit -m "feat(mcp-a2a): consult tools (ask/follow-up/get-conversation)"
```

---

## Task 6: 域3 进阶工具

**Files:**
- Create: `packages/mcp-a2a/src/tools/advanced.ts`

- [ ] **Step 1: 写实现**

```ts
import type { GatewayClient } from '../gateway-client.js';
import { type AskResult, askAgent } from './consult.js';

const MAX_PARALLEL = 5; // do not burn many recipients' tokens at once

export async function askMultiple(
  client: GatewayClient,
  input: { peerIds: string[]; question: string; waitSeconds: number },
): Promise<Array<AskResult & { peerId: string }>> {
  const targets = input.peerIds.slice(0, MAX_PARALLEL);
  const results = await Promise.all(
    targets.map(async (peerId) => ({
      peerId,
      ...(await askAgent(client, { peerId, question: input.question, waitSeconds: input.waitSeconds })),
    })),
  );
  return results;
}

interface ReplyResponse {
  status: 'answered' | 'pending';
  message?: { content: string | null };
}

export async function checkReply(
  client: GatewayClient,
  input: { conversationId: string; afterMessageId?: string },
): Promise<ReplyResponse> {
  const after = input.afterMessageId ? `after=${input.afterMessageId}&` : '';
  return client.get<ReplyResponse>(`/api/v1/consult/${input.conversationId}/reply?${after}wait=0`);
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-a2a/src/tools/advanced.ts
git commit -m "feat(mcp-a2a): advanced tools (ask-multiple capped, check-reply)"
```

---

## Task 7: 域4 ops 工具

**Files:**
- Create: `packages/mcp-a2a/src/tools/ops.ts`

- [ ] **Step 1: 写实现**

```ts
import type { GatewayClient } from '../gateway-client.js';

export function whoami(client: GatewayClient): { acting_as: string } {
  return { acting_as: client.whoami() };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp-a2a/src/tools/ops.ts
git commit -m "feat(mcp-a2a): ops tool (whoami)"
```

---

## Task 8: MCP server 入口 — 注册工具 + stdio

**Files:**
- Create: `packages/mcp-a2a/src/server.ts`

- [ ] **Step 1: 写 server**

```ts
#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { GatewayClient } from './gateway-client.js';
import { findAgents, getAgentCapabilities, listAgents } from './tools/discovery.js';
import { askAgent, followUp, getConversation } from './tools/consult.js';
import { askMultiple, checkReply } from './tools/advanced.js';
import { whoami } from './tools/ops.js';

const cfg = loadConfig();
const client = new GatewayClient(cfg);
const server = new McpServer({ name: 'confer-a2a', version: '0.1.0' });

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

// --- Domain 1: discovery ---
server.registerTool(
  'list_agents',
  { description: 'List peer agents you can consult (your contacts), with capabilities.', inputSchema: {} },
  async () => json(await listAgents(client)),
);
server.registerTool(
  'get_agent_capabilities',
  { description: 'Read a peer agent\'s AgentFacts capabilities.', inputSchema: { peerId: z.string() } },
  async ({ peerId }) => json(await getAgentCapabilities(client, peerId)),
);
server.registerTool(
  'find_agents',
  { description: 'Find contacts whose capabilities match a keyword.', inputSchema: { capability: z.string() } },
  async ({ capability }) => json(await findAgents(client, capability)),
);

// --- Domain 2: consult ---
const askShape = {
  peerId: z.string(),
  question: z.string(),
  codeContext: z.string().optional(),
  language: z.string().optional(),
  waitSeconds: z.number().int().min(0).max(55).optional(),
};
server.registerTool(
  'ask_agent',
  { description: 'Ask a peer agent a question; waits for the reply when waitSeconds > 0.', inputSchema: askShape },
  async (a) =>
    json(await askAgent(client, { ...a, waitSeconds: a.waitSeconds ?? cfg.defaultWaitSeconds })),
);
server.registerTool(
  'follow_up',
  { description: 'Ask a follow-up to the same peer in the existing consult thread.', inputSchema: askShape },
  async (a) =>
    json(await followUp(client, { ...a, waitSeconds: a.waitSeconds ?? cfg.defaultWaitSeconds })),
);
server.registerTool(
  'get_conversation',
  { description: 'Fetch the full message history of a consult thread.', inputSchema: { conversationId: z.string() } },
  async ({ conversationId }) => json(await getConversation(client, conversationId)),
);

// --- Domain 3: advanced ---
server.registerTool(
  'ask_multiple',
  {
    description: 'Ask the same question to several peers in parallel (capped at 5).',
    inputSchema: {
      peerIds: z.array(z.string()).min(1),
      question: z.string(),
      waitSeconds: z.number().int().min(0).max(55).optional(),
    },
  },
  async (a) =>
    json(await askMultiple(client, { ...a, waitSeconds: a.waitSeconds ?? cfg.defaultWaitSeconds })),
);
server.registerTool(
  'check_reply',
  {
    description: 'Non-blocking poll for a peer reply on an existing consult thread.',
    inputSchema: { conversationId: z.string(), afterMessageId: z.string().optional() },
  },
  async (a) => json(await checkReply(client, a)),
);

// --- Domain 4: ops ---
server.registerTool(
  'whoami',
  { description: 'Show which Confer user this MCP server acts as.', inputSchema: {} },
  async () => json(whoami(client)),
);

await server.connect(new StdioServerTransport());
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 无 error。若 SDK 的 `registerTool` 签名与此处不符(版本差异),以 `@modelcontextprotocol/sdk` 实际类型为准对齐(保持工具名/入参 schema 不变)。

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-a2a/src/server.ts
git commit -m "feat(mcp-a2a): stdio MCP server registering all consult tools"
```

---

## Task 9: 连接配置 + README + 冒烟

**Files:**
- Create/Modify: `.mcp.json`, `packages/mcp-a2a/README.md`

- [ ] **Step 1: .mcp.json(项目根)**

```json
{
  "mcpServers": {
    "confer-a2a": {
      "command": "bun",
      "args": ["run", "packages/mcp-a2a/src/server.ts"],
      "env": {
        "CONFER_GATEWAY_URL": "http://localhost:3000",
        "CONFER_USERNAME": "${CONFER_USERNAME}",
        "CONFER_PASSWORD": "${CONFER_PASSWORD}"
      }
    }
  }
}
```

- [ ] **Step 2: README** — 写明:gateway 须先 `bun run dev` 起在 :3000;设置 `CONFER_USERNAME`/`CONFER_PASSWORD`(一个已注册、已加好友若干 peer 的账号);列出 8 个工具与用法;说明回复是异步,`ask_agent` 默认阻塞 25s,慢 agent 用 `check_reply` 后取。

- [ ] **Step 3: 真实 Claude Code 连接冒烟(CLAUDE.md pitfall:MCP schema 校验严格)**

在另一终端,gateway 跑起来后,于本仓库执行 Claude Code,确认 `confer-a2a` 工具加载无 schema 报错,`whoami` 与 `list_agents` 可调用。
Expected: 工具列表出现 8 个 `confer-a2a` 工具;`whoami` 返回配置用户名;`list_agents` 返回联系人。

- [ ] **Step 4: Commit**

```bash
git add .mcp.json packages/mcp-a2a/README.md
git commit -m "docs(mcp-a2a): add .mcp.json connection config and README"
```

---

## Task 10: 文档同步(CLAUDE.md 硬规则)

**Files:**
- Modify: `docs/` 中 MCP / 集成对应文件;`CLAUDE.md` 的"Tech stack / automation"如需提及新 MCP server

- [ ] **Step 1: 记录** MCP server 的存在、工具清单、身份模型(以配置用户登录、私钥不出 gateway)、与 Layer 1 端点的对应关系。

- [ ] **Step 2: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: document confer-a2a MCP server"
```

---

## 自审清单(已核对)

- **Spec 覆盖**:域1=Task 4;域2(同步等待/多轮/历史)=Task 5;域3(并行/票据)=Task 6;域4(whoami/错误透传/PII)=Task 7 + 客户端结构化错误(Task 3 抛带状态码的 Error)+ 不打印 body。`pending_approval`:Layer 1 若 peer 返回待批,`ask_agent` 经 reply 长轮询超时呈现为 `pending`;如需独立 `pending_approval` 态,需 Layer 1 在 `/reply` 暴露 peer 的 202 状态(列为下方风险)。
- **占位符**:无 TODO;`registerTool`/契约字段标注了"以实际 SDK/响应为准核对",非隐性占位。
- **类型一致**:`AskResult`/`AskInput`、工具名(list_agents/get_agent_capabilities/find_agents/ask_agent/follow_up/get_conversation/ask_multiple/check_reply/whoami)、`waitSeconds` 上限 55s 与 Layer 1 `/reply` 的 `wait` 上限一致。

## 风险

- **MCP SDK 版本 API**:`registerTool` 入参形态随版本演进;Task 8 Step 2 已要求按实际类型对齐。
- **`pending_approval` 粒度**:首版用 `pending` 涵盖"待批/peer 未答";若要区分,需 Layer 1 在回复端点回传权限态,作为后续增量。
- **contacts 响应字段**:Task 4 的 `ContactsResponse` 需按 gateway 实际响应核对。
- **身份单一**:MCP 仅以一个配置用户行动(符合设计);多身份切换非本期范围。

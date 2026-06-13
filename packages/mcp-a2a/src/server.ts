#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { GatewayClient } from './gateway-client.js';
import { askMultiple, checkReply } from './tools/advanced.js';
import { askPerson } from './tools/ask-person.js';
import { askAgent, followUp, getConversation } from './tools/consult.js';
import { discoverPeer } from './tools/discover.js';
import { findAgents, getAgentCapabilities, listAgents } from './tools/discovery.js';
import { whoami } from './tools/ops.js';
import { readProjectMemory, writeProjectMemory } from './tools/project-memory.js';
import { requestCodeReview, requestDesignReview } from './tools/review.js';

const cfg = loadConfig();
const client = new GatewayClient(cfg);
const server = new McpServer({ name: 'confer-a2a', version: '0.1.0' });

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const waitSecondsField = z.number().int().min(0).max(55).optional();

// Fill in the configured default when the caller omits waitSeconds.
const withWait = <T extends { waitSeconds?: number }>(a: T): T & { waitSeconds: number } => ({
  ...a,
  waitSeconds: a.waitSeconds ?? cfg.defaultWaitSeconds,
});

const askShape = {
  peerId: z.string(),
  question: z.string(),
  codeContext: z.string().optional(),
  language: z.string().optional(),
  waitSeconds: waitSecondsField,
};

// --- Domain 1: discovery ---
server.registerTool(
  'list_agents',
  {
    description: 'List peer agents you can consult (your contacts), with capabilities.',
    inputSchema: {},
  },
  async () => json(await listAgents(client)),
);
server.registerTool(
  'get_agent_capabilities',
  {
    description: "Read a peer agent's AgentFacts capabilities.",
    inputSchema: { peerId: z.string() },
  },
  async ({ peerId }) => json(await getAgentCapabilities(client, peerId)),
);
server.registerTool(
  'find_agents',
  {
    description: 'Find contacts whose capabilities match a keyword.',
    inputSchema: { capability: z.string() },
  },
  async ({ capability }) => json(await findAgents(client, capability)),
);

// --- Domain 2: consult ---
server.registerTool(
  'ask_agent',
  {
    description: 'Ask a peer agent a question; waits for the reply when waitSeconds > 0.',
    inputSchema: askShape,
  },
  async (a) => json(await askAgent(client, withWait(a))),
);
server.registerTool(
  'follow_up',
  {
    description: 'Ask a follow-up to the same peer in the existing consult thread.',
    inputSchema: askShape,
  },
  async (a) => json(await followUp(client, withWait(a))),
);
server.registerTool(
  'get_conversation',
  {
    description: 'Fetch the full message history of a consult thread.',
    inputSchema: { conversationId: z.string() },
  },
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
      waitSeconds: waitSecondsField,
    },
  },
  async (a) => json(await askMultiple(client, withWait(a))),
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

// --- Domain 5: ask a specific person's agent ---
server.registerTool(
  'ask_person_agent',
  {
    description:
      "Ask a specific person's agent a question that only that person can answer. " +
      'Returns immediately with a conversation handle; poll check_reply for the answer.',
    inputSchema: { person: z.string(), question: z.string() },
  },
  async ({ person, question }) => json(await askPerson(client, { person, question })),
);

// --- Domain 6: project memory (per-project, per-peer facts/decisions) ---
server.registerTool(
  'read_project_memory',
  {
    description:
      "Read what you've recorded about a peer agent in this project (facts and/or decisions). " +
      'Omit `section` to read both. Empty result means no notes yet for this peer in this project.',
    inputSchema: {
      peerId: z.string(),
      section: z.enum(['facts', 'decisions']).optional(),
      project: z.string().optional(),
    },
  },
  async ({ peerId, section, project }) =>
    json(
      await readProjectMemory(client, {
        projectId: project ?? cfg.projectId,
        peerId,
        section,
      }),
    ),
);
server.registerTool(
  'write_project_memory',
  {
    description:
      'Record durable notes about a peer agent for this project. `section` is "facts" ' +
      '(stable knowledge) or "decisions" (choices made). Writing one section never clears ' +
      'the other. Versions increment on each write.',
    inputSchema: {
      peerId: z.string(),
      section: z.enum(['facts', 'decisions']),
      content: z.string(),
      project: z.string().optional(),
    },
  },
  async ({ peerId, section, content, project }) =>
    json(
      await writeProjectMemory(client, {
        projectId: project ?? cfg.projectId,
        peerId,
        section,
        content,
      }),
    ),
);

// --- Domain 7: discovery + review ---
server.registerTool(
  'discover_peer',
  {
    description:
      'Discover a peer agent by domain, DID, or username. Returns candidates (each with a ' +
      'peer_id) and records the peer locally, but does NOT add it as a contact: you must ' +
      'accept the peer in the main Confer app before you can write its memory or consult it ' +
      '(otherwise those calls return 403). This is the consent gate.',
    inputSchema: {
      method: z.enum(['domain', 'did', 'username']),
      value: z.string(),
    },
  },
  async ({ method, value }) => json(await discoverPeer(client, { method, value })),
);
server.registerTool(
  'request_design_review',
  {
    description:
      'Ask a peer agent to review a plan before you implement it. Waits for the reply when ' +
      'waitSeconds > 0. The peer must already be a contact.',
    inputSchema: {
      peerId: z.string(),
      plan: z.string(),
      scope: z.string().optional(),
      language: z.string().optional(),
      waitSeconds: waitSecondsField,
    },
  },
  async (a) => json(await requestDesignReview(client, withWait(a))),
);
server.registerTool(
  'request_code_review',
  {
    description:
      'Ask a peer agent to review one or more files. Waits for the reply when waitSeconds > 0. ' +
      'The peer must already be a contact.',
    inputSchema: {
      peerId: z.string(),
      files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
      focus: z.string().optional(),
      language: z.string().optional(),
      waitSeconds: waitSecondsField,
    },
  },
  async (a) => json(await requestCodeReview(client, withWait(a))),
);

await server.connect(new StdioServerTransport());

#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { GatewayClient } from './gateway-client.js';
import { askMultiple, checkReply } from './tools/advanced.js';
import { askAgent, followUp, getConversation } from './tools/consult.js';
import { findAgents, getAgentCapabilities, listAgents } from './tools/discovery.js';
import { whoami } from './tools/ops.js';

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

await server.connect(new StdioServerTransport());

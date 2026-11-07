import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real MCP stdio connection lists strict schemas, uses device credentials and syncs Markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'confer-mcp-smoke-'));
  const peerId = '01J00000000000000000000001';
  let authenticated = 0;
  const gateway = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      if (request.headers.get('authorization') !== 'Bearer cfr_smoke_only')
        return new Response('', { status: 401 });
      authenticated++;
      const path = new URL(request.url).pathname;
      if (path === '/api/v1/users/me')
        return Response.json({ user: { id: '01J00000000000000000000002', username: 'alice' } });
      if (path === '/api/v1/contacts') return Response.json({ contacts: [] });
      if (path.endsWith('/memory'))
        return Response.json({
          facts_md: '# Facts\nX100',
          decisions_md: '# Decisions\nManual only',
          version: 1,
        });
      return new Response('', { status: 404 });
    },
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./server.ts', import.meta.url))],
    cwd: root,
    env: {
      PATH: process.env.PATH ?? '',
      CONFER_GATEWAY_URL: `http://127.0.0.1:${gateway.port}`,
      CONFER_USERNAME: 'alice',
      CONFER_API_TOKEN: 'cfr_smoke_only',
      CONFER_PROJECT_ID: 'smoke',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'confer-smoke', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('sync_project_memory');
    expect(listed.tools.map((tool) => tool.name)).toContain('ask_agent');
    const agents = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(agents.isError).not.toBe(true);
    const synced = await client.callTool({
      name: 'sync_project_memory',
      arguments: { peerId, direction: 'pull' },
    });
    expect(synced.isError).not.toBe(true);
    expect(await readFile(join(root, '.confer', 'peers', peerId, 'facts.md'), 'utf8')).toBe(
      '# Facts\nX100',
    );
    const identity = await client.callTool({ name: 'whoami', arguments: {} });
    expect(JSON.stringify(identity.content)).toContain('alice');
    expect(authenticated).toBe(4);
  } finally {
    await client.close();
    gateway.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

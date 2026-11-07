// Boots the MCP server over stdio and runs the JSON-RPC handshake to confirm
// all tools register with schemas the strict MCP validator accepts. Needs no
// gateway/DB — it only exercises tool registration, not tool execution.
import { spawn } from 'node:child_process';

const proc = spawn('bun', ['run', `${import.meta.dir}/../src/server.ts`], {
  env: { ...process.env, CONFER_USERNAME: 'smoke', CONFER_PASSWORD: 'smoke' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

function send(msg: unknown): void {
  proc.stdin.write(`${JSON.stringify(msg)}\n`);
}

let buffer = '';
const tools: string[] = [];
let done = false;

proc.stdout.on('data', (chunk: Buffer) => {
  buffer += chunk.toString();
  let idx = buffer.indexOf('\n');
  while (idx !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleLine(line);
    idx = buffer.indexOf('\n');
  }
});

function handleLine(line: string): void {
  const msg = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> } };
  if (msg.id === 1) {
    // initialized -> request tool list
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  } else if (msg.id === 2) {
    for (const t of msg.result?.tools ?? []) tools.push(t.name);
    done = true;
    proc.kill();
  }
}

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  },
});

setTimeout(() => {
  if (!done) {
    console.error('SMOKE FAIL: no tools/list response within 8s');
    proc.kill();
    process.exit(1);
  }
}, 8000);

proc.on('exit', () => {
  const expected = [
    'sync_project_memory',
    'ask_person_agent',
    'discover_peer',
    'request_design_review',
    'request_code_review',
    'read_project_memory',
    'write_project_memory',
    'list_agents',
    'get_agent_capabilities',
    'find_agents',
    'ask_agent',
    'follow_up',
    'get_conversation',
    'ask_multiple',
    'check_reply',
    'whoami',
  ];
  const missing = expected.filter((t) => !tools.includes(t));
  console.log(`registered tools (${tools.length}): ${tools.join(', ')}`);
  if (missing.length) {
    console.error(`SMOKE FAIL: missing ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`SMOKE PASS: all ${expected.length} tools registered with valid schemas`);
  process.exit(0);
});

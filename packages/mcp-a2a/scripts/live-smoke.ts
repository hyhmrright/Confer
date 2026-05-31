// Live round-trip against a running gateway: register a throwaway user, then
// drive the real GatewayClient + tools to prove the MCP HTTP/auth path and that
// the consult route logic executes. Requires gateway reachable at GATEWAY.
import { GatewayClient } from '../src/gateway-client.js';
import { askAgent } from '../src/tools/consult.js';
import { listAgents } from '../src/tools/discovery.js';
import { whoami } from '../src/tools/ops.js';

const GATEWAY = process.env.CONFER_GATEWAY_URL ?? 'http://localhost/api/..';
const base = (process.env.CONFER_GATEWAY_BASE ?? 'http://localhost').replace(/\/$/, '');
const username = `mcpsmoke_${Date.now().toString(36)}`;
const password = 'Smoke-Pass-123456';

async function main(): Promise<void> {
  const reg = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!reg.ok) throw new Error(`register failed: ${reg.status} ${await reg.text()}`);

  const client = new GatewayClient({
    gatewayUrl: base,
    username,
    password,
    defaultWaitSeconds: 1,
  });

  console.log('whoami:', JSON.stringify(whoami(client)));

  const agents = await listAgents(client);
  console.log(`list_agents: ${agents.length} contacts (expected 0 for fresh user)`);

  // Consulting a non-contact peer must be rejected by the live route (403 ->
  // gateway-client throws). Proves the consult endpoint logic runs end-to-end.
  try {
    await askAgent(client, {
      peerId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      question: 'ping',
      waitSeconds: 0,
    });
    console.error('LIVE SMOKE FAIL: consult of non-contact should have been rejected');
    process.exit(1);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('403')) {
      console.error(`LIVE SMOKE FAIL: unexpected error: ${msg}`);
      process.exit(1);
    }
    console.log('consult non-contact correctly rejected (403)');
  }

  console.log('LIVE SMOKE PASS');
}

void GATEWAY;
main().catch((e) => {
  console.error('LIVE SMOKE ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});

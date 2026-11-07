import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { knowledgeDocuments, messages } from '../db/schema.js';
import { settleDetached } from '../lib/background.js';
import { ensureCollection, searchChunks } from '../lib/qdrant.js';
import { VECTOR_SIZE } from '../lib/rag-config.js';
import { apiRequest, del, get, mockFetch, post, put, resetDb } from '../test/helpers.js';

let restore: (() => void) | undefined;
afterEach(async () => {
  await settleDetached();
  restore?.();
  restore = undefined;
});

// A reproducible mock-vendor demonstration through real registration, contact
// lookup, file upload, embeddings, owner grant, consult, HTTP signatures, reply,
// feedback and exclusion. No hand-seeded signing keys or private-data fixtures.
test('X100 demo: signed consult, scoped sources, human consent and stale-source exclusion', async () => {
  await resetDb();
  await ensureCollection();
  const vector = new Array(VECTOR_SIZE).fill(0);
  vector[0] = 1;
  let signatureCount = 0;
  restore = mockFetch((url, init, input) => {
    if (url.includes('/a2a/v1/messages') && input instanceof Request) {
      expect(input.headers.has('signature')).toBe(true);
      signatureCount++;
      return Promise.resolve(app.request(input));
    }
    if (url.includes('/embeddings')) {
      const { input: texts } = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({ data: texts.map((_, index) => ({ index, embedding: vector })) });
    }
    if (url.includes('api.anthropic.com')) {
      const body = JSON.parse(String(init?.body)) as {
        stream?: boolean;
        messages: { role: string; content: unknown }[];
      };
      if (!body.stream)
        return Response.json({
          content: [{ type: 'text', text: '[]' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      const searched = body.messages.some((m) => JSON.stringify(m.content).includes('tool_result'));
      const events = searched
        ? [
            { type: 'message_start', message: { role: 'assistant' } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'text_delta',
                text: 'X100: 24 V DC; Modbus RTU on RS-485. [X100 demo manual]',
              },
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
            { type: 'message_stop' },
          ]
        : [
            { type: 'message_start', message: { role: 'assistant' } },
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'demo-search',
                name: 'search_knowledge_base',
                input: {},
              },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '{"query":"X100 wiring"}' },
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
            { type: 'message_stop' },
          ];
      return new Response(
        events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    return undefined;
  });
  const register = async (username: string) => {
    const res = await post('/api/v1/auth/register', {
      body: { username, password: 'demo-only-test-password', device_id: 'demo-test' },
    });
    expect(res.status).toBe(201);
    return res.json() as Promise<{
      access_token: string;
      user: { id: string; did: string; username: string };
    }>;
  };
  const buyer = await register('demo-buyer');
  const vendor = await register('demo-vendor');
  await apiRequest('/api/v1/agents/me', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${vendor.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ is_public: true, model_config_json: { provider: 'anthropic' } }),
  });
  await apiRequest('/api/v1/agents/me', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${buyer.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ is_public: true }),
  });
  const connect = async (token: string, username: string) => {
    const lookup = await (
      await post('/api/v1/contacts/lookup', {
        token,
        body: { method: 'username', value: username },
      })
    ).json();
    const peer = lookup.candidates[0];
    expect(peer).toBeDefined();
    expect((await post('/api/v1/contacts', { token, body: { peer_id: peer.id } })).status).toBe(
      201,
    );
    return peer.id as string;
  };
  const vendorPeer = await connect(buyer.access_token, vendor.user.username);
  const buyerPeer = await connect(vendor.access_token, buyer.user.username);
  for (const provider of ['openai', 'anthropic'])
    expect(
      (
        await put('/api/v1/agents/me/llm-keys', {
          token: vendor.access_token,
          body: { provider, api_key: 'demo-only-mocked-key' },
        })
      ).status,
    ).toBe(200);
  const kb = await (
    await post('/api/v1/knowledge-bases', {
      token: vendor.access_token,
      body: { name: 'X100 demo manual' },
    })
  ).json();
  const kbId = kb.knowledge_base.id as string;
  await apiRequest(`/api/v1/knowledge-bases/${kbId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${vendor.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shared_with_peers: true }),
  });
  const form = new FormData();
  form.append(
    'file',
    new File(
      ['X100 fictional demo controller. Power: 24 V DC. Protocol: Modbus RTU over RS-485.'],
      'X100-demo.txt',
      { type: 'text/plain' },
    ),
  );
  const upload = await apiRequest(`/api/v1/knowledge-bases/${kbId}/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${vendor.access_token}` },
    body: form,
  });
  expect(upload.status).toBe(201);
  const docId = (await upload.json()).document.id as string;
  await settleDetached();
  const issuedRes = await post('/api/v1/capabilities', {
    token: vendor.access_token,
    body: {
      name: 'Buyer X100 access',
      peer_id: buyerPeer,
      signer_did: buyer.user.did,
      kb_ids: [kbId],
      expires_in_hours: 1,
    },
  });
  expect(issuedRes.status).toBe(201);
  const issued = await issuedRes.json();
  expect(
    (
      await put(`/api/v1/capabilities/remote/${vendorPeer}`, {
        token: buyer.access_token,
        body: { token: issued.token },
      })
    ).status,
  ).toBe(200);
  const consult = await post(`/api/v1/consult/${vendorPeer}`, {
    token: buyer.access_token,
    body: { question: 'How do I wire X100?', wait_seconds: 0 },
  });
  expect(consult.status).toBe(201);
  await settleDetached();
  const [answer] = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.sender_type, 'own_agent'));
  expect(answer?.content).toContain('24 V DC');
  expect(answer?.citations_json).toEqual(
    expect.arrayContaining([expect.objectContaining({ doc_id: docId, kb_id: kbId })]),
  );
  expect(signatureCount).toBe(2);
  const [received] = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.sender_type, 'peer_agent'));
  // There are two inbound rows: the vendor's question, then the buyer's answer.
  const receivedRows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.sender_type, 'peer_agent'));
  const withSources = receivedRows.find(
    (row) => Array.isArray(row.citations_json) && row.citations_json.length > 0,
  );
  expect(received).toBeDefined();
  expect(withSources?.citations_json).toEqual([
    expect.objectContaining({ doc_name: 'X100-demo.txt', trust_level: 'unverified' }),
  ]);
  expect(JSON.stringify(withSources?.citations_json)).not.toContain(docId);
  expect(
    (
      await post('/api/v1/feedback', {
        token: vendor.access_token,
        body: {
          message_id: answer?.id,
          kind: 'outdated_source',
          note: 'Replace with revised X100 manual.',
        },
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post(`/api/v1/knowledge-bases/${kbId}/documents/${docId}/outdated`, {
        token: buyer.access_token,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await post(`/api/v1/knowledge-bases/${kbId}/documents/${docId}/outdated`, {
        token: vendor.access_token,
      })
    ).status,
  ).toBe(200);
  expect(await searchChunks(vector, vendor.user.id, [kbId], 5, 'openai')).toEqual([]);
  const [doc] = await getDb()
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, docId));
  expect(doc?.status).toBe('outdated');
  await del(`/api/v1/capabilities/${issued.grant.id}`, { token: vendor.access_token });
  const revoked = await post(`/api/v1/consult/${vendorPeer}`, {
    token: buyer.access_token,
    body: { question: 'Again?', wait_seconds: 0 },
  });
  expect(revoked.status).toBe(502);
  expect((await get('/api/v1/feedback', { token: buyer.access_token })).status).toBe(200);
});

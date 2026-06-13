import { describe, expect, test } from 'bun:test';
import type { GatewayClient } from '../gateway-client.js';
import { requestCodeReview, requestDesignReview } from './review.js';

// Capture the POST body so we can assert the constructed question/code_context.
function clientStub(routes: Record<string, unknown>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    post: async (p: string, body?: unknown) => {
      calls.push({ path: p, body: body as Record<string, unknown> });
      return routes[`POST ${p}`];
    },
    get: async (p: string) => routes[`GET ${p.split('?')[0]}`],
    whoami: () => 'u',
  } as unknown as GatewayClient;
  return { client, calls };
}

describe('requestDesignReview', () => {
  test('builds a question with a ## Plan section and consults the peer', async () => {
    const { client, calls } = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
      'GET /api/v1/consult/c1/reply': { status: 'answered', message: { content: 'looks good' } },
    });
    const out = await requestDesignReview(client, {
      peerId: 'peer1',
      plan: 'Add a projects route',
      waitSeconds: 5,
    });
    const question = calls[0]?.body.question as string;
    expect(question).toContain('# Design review request');
    expect(question).toContain('## Plan');
    expect(question).toContain('Add a projects route');
    expect(out.status).toBe('answered');
    expect(out.answer).toBe('looks good');
  });

  test('includes the scope in the heading when given', async () => {
    const { client, calls } = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
    });
    await requestDesignReview(client, {
      peerId: 'peer1',
      plan: 'p',
      scope: 'auth flow',
      waitSeconds: 0,
    });
    expect(calls[0]?.body.question).toContain('# Design review request — auth flow');
  });
});

describe('requestCodeReview', () => {
  test('puts focus in the question and the files in code_context', async () => {
    const { client, calls } = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
    });
    await requestCodeReview(client, {
      peerId: 'peer1',
      files: [
        { path: 'a.ts', content: 'const a = 1;' },
        { path: 'b.ts', content: 'const b = 2;' },
      ],
      focus: 'race conditions',
      waitSeconds: 0,
    });
    const body = calls[0]?.body as { question: string; code_context: string };
    expect(body.question).toContain('# Code review request');
    expect(body.question).toContain('Focus: race conditions');
    expect(body.code_context).toContain('## a.ts');
    expect(body.code_context).toContain('const a = 1;');
    expect(body.code_context).toContain('## b.ts');
    expect(body.code_context).toContain('const b = 2;');
  });

  test('defaults the focus when omitted', async () => {
    const { client, calls } = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
    });
    await requestCodeReview(client, {
      peerId: 'peer1',
      files: [{ path: 'a.ts', content: 'x' }],
      waitSeconds: 0,
    });
    expect((calls[0]?.body as { question: string }).question).toContain(
      'correctness + vendor gotchas',
    );
  });
});

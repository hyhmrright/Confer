import { describe, expect, test } from 'bun:test';
import type { GatewayClient } from '../gateway-client.js';
import { askPerson } from './ask-person.js';

// Capture the path/body the tool posts, and return a canned probe response.
function clientStub(captured: { path?: string; body?: unknown }): GatewayClient {
  return {
    post: async (path: string, body?: unknown) => {
      captured.path = path;
      captured.body = body;
      return { ask_id: 'a1', conversation_id: 'c1', status: 'pending' };
    },
    whoami: () => 'u',
  } as unknown as GatewayClient;
}

describe('askPerson', () => {
  test('posts person + question to the probe endpoint', async () => {
    const captured: { path?: string; body?: unknown } = {};
    await askPerson(clientStub(captured), { person: 'Bob', question: 'why this design?' });
    expect(captured.path).toBe('/api/v1/probe/ask-person');
    expect(captured.body).toEqual({ person: 'Bob', question: 'why this design?' });
  });

  test('maps the response to a pending handle', async () => {
    const result = await askPerson(clientStub({}), { person: 'Bob', question: 'q' });
    expect(result).toEqual({ status: 'pending', askId: 'a1', conversationId: 'c1' });
  });
});

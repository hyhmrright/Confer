import type { GatewayClient } from '../gateway-client.js';

export interface AskPersonInput {
  person: string;
  question: string;
}

export interface AskPersonResult {
  status: 'pending';
  askId: string;
  conversationId: string;
}

// Shape of POST /api/v1/probe/ask-person.
interface AskPersonResponse {
  ask_id: string;
  conversation_id: string;
  status: 'pending';
}

// Ask a named person's agent a question (Idea C probe). The call is async: it
// records the ask, opens a placeholder thread, and returns immediately with a
// conversation handle. The host retrieves the answer later via `check_reply`
// against the returned conversation id.
export async function askPerson(
  client: GatewayClient,
  input: AskPersonInput,
): Promise<AskPersonResult> {
  const res = await client.post<AskPersonResponse>('/api/v1/probe/ask-person', {
    person: input.person,
    question: input.question,
  });
  return {
    status: 'pending',
    askId: res.ask_id,
    conversationId: res.conversation_id,
  };
}

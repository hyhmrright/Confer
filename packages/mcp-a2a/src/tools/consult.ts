import type { GatewayClient } from '../gateway-client.js';
import type { ReplyResponse } from '../types.js';

interface InitiateResponse {
  conversation_id: string;
  message_id: string;
  status: 'sent' | 'failed';
  error?: string;
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
  const peer = encodeURIComponent(input.peerId);
  const initiated = await client.post<InitiateResponse>(`/api/v1/consult/${peer}`, {
    question: input.question,
    code_context: input.codeContext,
    language: input.language,
  });

  const handle = { conversationId: initiated.conversation_id, messageId: initiated.message_id };

  if (initiated.status === 'failed') {
    return { status: 'failed', ...handle, error: initiated.error };
  }

  if (input.waitSeconds <= 0) {
    return { status: 'pending', ...handle };
  }

  const reply = await client.get<ReplyResponse>(
    `/api/v1/consult/${encodeURIComponent(handle.conversationId)}/reply?after=${encodeURIComponent(handle.messageId)}&wait=${input.waitSeconds}`,
  );
  if (reply.status === 'answered') {
    return { status: 'answered', ...handle, answer: reply.message?.content ?? '' };
  }
  return { status: 'pending', ...handle };
}

// A follow-up reuses the per-peer consult thread (the gateway keeps one
// conversation per peer), so it is the same operation keyed by peerId.
export const followUp = askAgent;

export async function getConversation(
  client: GatewayClient,
  conversationId: string,
): Promise<unknown> {
  return client.get(`/api/v1/consult/${encodeURIComponent(conversationId)}`);
}

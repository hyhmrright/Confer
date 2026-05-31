import type { GatewayClient } from '../gateway-client.js';
import { type AskResult, askAgent } from './consult.js';

const MAX_PARALLEL = 5; // do not burn many recipients' tokens at once

export async function askMultiple(
  client: GatewayClient,
  input: { peerIds: string[]; question: string; waitSeconds: number },
): Promise<Array<AskResult & { peerId: string }>> {
  const targets = input.peerIds.slice(0, MAX_PARALLEL);
  return Promise.all(
    targets.map(async (peerId) => ({
      peerId,
      ...(await askAgent(client, {
        peerId,
        question: input.question,
        waitSeconds: input.waitSeconds,
      })),
    })),
  );
}

interface ReplyResponse {
  status: 'answered' | 'pending';
  message?: { content: string | null };
}

export async function checkReply(
  client: GatewayClient,
  input: { conversationId: string; afterMessageId?: string },
): Promise<ReplyResponse> {
  const after = input.afterMessageId ? `after=${input.afterMessageId}&` : '';
  return client.get<ReplyResponse>(`/api/v1/consult/${input.conversationId}/reply?${after}wait=0`);
}

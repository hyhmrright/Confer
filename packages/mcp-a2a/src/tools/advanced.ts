import type { GatewayClient } from '../gateway-client.js';
import type { ReplyResponse } from '../types.js';
import { type AskResult, askAgent } from './consult.js';

const MAX_PARALLEL = 5; // do not burn many recipients' tokens at once

export async function askMultiple(
  client: GatewayClient,
  input: { peerIds: string[]; question: string; waitSeconds: number },
): Promise<Array<AskResult & { peerId: string }>> {
  const targets = input.peerIds.slice(0, MAX_PARALLEL);
  return Promise.all(
    targets.map(async (peerId) => {
      try {
        return {
          peerId,
          ...(await askAgent(client, {
            peerId,
            question: input.question,
            waitSeconds: input.waitSeconds,
          })),
        };
      } catch (e) {
        // One peer failing must not sink the whole batch.
        return {
          peerId,
          status: 'failed' as const,
          conversationId: '',
          messageId: '',
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
}

export async function checkReply(
  client: GatewayClient,
  input: { conversationId: string; afterMessageId?: string },
): Promise<ReplyResponse> {
  const after = input.afterMessageId ? `after=${encodeURIComponent(input.afterMessageId)}&` : '';
  return client.get<ReplyResponse>(
    `/api/v1/consult/${encodeURIComponent(input.conversationId)}/reply?${after}wait=0`,
  );
}

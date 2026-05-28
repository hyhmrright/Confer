import { importPrivateKey, signRequest } from '@confer/identity';
import { type Result, err, ok } from '@confer/shared';

export interface OutboundA2AMessage {
  from: string;
  to: string;
  thread_id?: string;
  message: {
    type: 'question' | 'answer' | 'notification';
    content: string;
    language?: string;
  };
}

export interface OutboundResult {
  message_id: string;
  thread_id: string;
  stream_url: string;
}

export async function sendA2AMessage(
  endpoint: string,
  message: OutboundA2AMessage,
  signerKeyId: string,
  privateKeyJwk: string,
): Promise<Result<OutboundResult, string>> {
  try {
    const body = JSON.stringify(message);
    const url = `${endpoint}/messages`;

    const baseRequest = new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
    });

    const privateKey = await importPrivateKey(JSON.parse(privateKeyJwk) as JsonWebKey);
    const signedRequest = await signRequest(baseRequest, privateKey, signerKeyId);

    const response = await fetch(signedRequest, { signal: AbortSignal.timeout(10_000) });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return err(`Remote returned ${response.status}: ${text}`);
    }

    const data = (await response.json()) as OutboundResult;
    return ok(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`sendA2AMessage failed: ${message}`);
  }
}

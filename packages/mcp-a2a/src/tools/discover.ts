import type { GatewayClient } from '../gateway-client.js';

export type DiscoverMethod = 'domain' | 'did' | 'username';

export interface DiscoverInput {
  method: DiscoverMethod;
  value: string;
}

interface LookupResponse {
  candidates: unknown[];
  method: string;
  error?: string;
}

export interface DiscoverResult {
  method: string;
  candidates: unknown[];
  error?: string;
}

// Look up a peer by domain, DID, or username. The gateway upserts the discovered
// peer_agents row and returns candidates (each carrying a local peer_id), but it
// does NOT add the peer as a contact. Until the user accepts the peer in the main
// app, writing memory or consulting it returns 403 (the consent gate).
export async function discoverPeer(
  client: GatewayClient,
  input: DiscoverInput,
): Promise<DiscoverResult> {
  const res = await client.post<LookupResponse>('/api/v1/contacts/lookup', {
    method: input.method,
    value: input.value,
  });
  return { method: res.method, candidates: res.candidates, error: res.error };
}

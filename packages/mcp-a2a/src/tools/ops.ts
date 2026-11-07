import type { GatewayClient } from '../gateway-client.js';

export async function whoami(client: GatewayClient): Promise<{ acting_as: string }> {
  // A device/API credential may be configured without a username. The server,
  // rather than a local label, is the authority on whose data the tool accesses.
  const profile = await client.get<{ user: { username: string } }>('/api/v1/users/me');
  return { acting_as: profile.user.username };
}

import type { GatewayClient } from '../gateway-client.js';

export function whoami(client: GatewayClient): { acting_as: string } {
  return { acting_as: client.whoami() };
}

import { basename } from 'node:path';

export interface McpConfig {
  gatewayUrl: string;
  username: string;
  password: string;
  defaultWaitSeconds: number;
  projectId: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const gatewayUrl = env.CONFER_GATEWAY_URL ?? 'http://localhost:3000';
  const username = env.CONFER_USERNAME;
  const password = env.CONFER_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'CONFER_USERNAME and CONFER_PASSWORD must be set for the MCP server to authenticate',
    );
  }
  const defaultWaitSeconds = Number(env.CONFER_CONSULT_WAIT ?? '25');
  // Default the project scope to the working directory's name so memory is keyed
  // per checkout without extra config; override with CONFER_PROJECT_ID.
  const projectId = env.CONFER_PROJECT_ID ?? basename(process.cwd());
  return {
    gatewayUrl: gatewayUrl.replace(/\/$/, ''),
    username,
    password,
    defaultWaitSeconds,
    projectId,
  };
}

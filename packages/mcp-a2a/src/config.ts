import { basename } from 'node:path';

export interface McpConfig {
  gatewayUrl: string;
  username: string;
  password: string;
  defaultWaitSeconds: number;
  projectId: string;
}

const UNEXPANDED_PLACEHOLDER = /^\$\{.*\}$/;

// Every value in the plugin's .mcp.json is written as `${VAR}`, and Claude Code
// passes that literal string through when the variable is not exported. Read it
// as missing, or it satisfies the checks below and resurfaces far away as an
// authentication failure that says nothing about the real cause.
function expanded(value: string | undefined): string | undefined {
  return value === undefined || UNEXPANDED_PLACEHOLDER.test(value) ? undefined : value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const gatewayUrl = expanded(env.CONFER_GATEWAY_URL) ?? 'http://localhost:3000';
  const username = expanded(env.CONFER_USERNAME);
  const password = expanded(env.CONFER_PASSWORD);
  if (!username || !password) {
    throw new Error(
      'CONFER_USERNAME and CONFER_PASSWORD must be set for the MCP server to authenticate. ' +
        'Export them in the shell before launching Claude Code.',
    );
  }
  const defaultWaitSeconds = Number(expanded(env.CONFER_CONSULT_WAIT) ?? '25');
  // Default the project scope to the working directory's name so memory is keyed
  // per checkout without extra config; override with CONFER_PROJECT_ID.
  const projectId = expanded(env.CONFER_PROJECT_ID) ?? basename(process.cwd());
  return {
    gatewayUrl: gatewayUrl.replace(/\/$/, ''),
    username,
    password,
    defaultWaitSeconds,
    projectId,
  };
}

import { spawn } from 'node:child_process';
import { saveCredentials } from './credentials.js';

export function normalizeGateway(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use a gateway origin without a path or credentials.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('Remote gateways require HTTPS.');
  }
  return url.origin;
}

export async function deviceLogin(gateway: string, name = 'Confer developer tool'): Promise<void> {
  const origin = normalizeGateway(gateway);
  const start = await fetch(`${origin}/api/v1/device-auth/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!start.ok) throw new Error(`Device authorization failed (${start.status}).`);
  const request = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_path: string;
    expires_in: number;
    interval: number;
  };
  // Construct the destination locally. Never open a server-selected arbitrary URL.
  const url = `${origin}/connect?code=${encodeURIComponent(request.user_code)}`;
  process.stderr.write(
    `Open ${url}\nConfirm code ${request.user_code} and device name "${name}" in your signed-in browser.\n`,
  );
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : undefined;
  if (command) {
    const child = spawn(command, [url], { stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }
  const deadline = Date.now() + Math.min(request.expires_in, 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(5, request.interval) * 1000));
    const res = await fetch(`${origin}/api/v1/device-auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: request.device_code }),
    });
    if (res.status === 202) continue;
    if (!res.ok)
      throw new Error(
        `Device authorization ended (${res.status}). Start again if it was denied or expired.`,
      );
    const credentials = (await res.json()) as { token: string; username: string };
    saveCredentials(origin, credentials);
    process.stderr.write(
      `Connected as ${credentials.username}. Credential saved in your OS keychain; revoke it in Settings → Security.\n`,
    );
    return;
  }
  throw new Error('Device authorization expired.');
}

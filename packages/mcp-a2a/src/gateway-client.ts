import type { McpConfig } from './config.js';

type FetchFn = typeof fetch;

/**
 * Thin authenticated client over the Confer gateway REST API. Logs in lazily
 * with the configured user's credentials, caches the JWT, and re-logs in once
 * on a 401 before retrying. The gateway holds the signing key; this client only
 * ever carries a bearer token.
 */
export class GatewayClient {
  private token: string | null = null;

  constructor(
    private readonly cfg: McpConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async login(): Promise<void> {
    const res = await this.fetchFn(`${this.cfg.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: this.cfg.username,
        password: this.cfg.password,
        device_id: 'mcp-a2a',
      }),
    });
    if (!res.ok) throw new Error(`gateway login failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string };
    this.token = body.access_token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) await this.login();
    const send = () =>
      this.fetchFn(`${this.cfg.gatewayUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let res = await send();
    if (res.status === 401) {
      await this.login();
      res = await send();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`gateway ${method} ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  whoami(): string {
    return this.cfg.username;
  }
}

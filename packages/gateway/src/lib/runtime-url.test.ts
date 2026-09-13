import { afterEach, describe, expect, test } from 'bun:test';
import net from 'node:net';
import { isRuntimeBaseUrl, runtimeFetcher } from './runtime-url.js';

describe('isRuntimeBaseUrl', () => {
  test('accepts the addresses a local runtime is actually reached at', () => {
    for (const value of [
      'http://host.docker.internal:11434',
      'http://host.docker.internal:11434/',
      'http://127.0.0.1:1234/v1',
      'https://ollama.lan',
    ]) {
      expect(isRuntimeBaseUrl(value)).toBe(true);
    }
  });

  // Every dialer appends a path; each of these would let the stored value
  // choose it instead, or is not an address at all.
  test('refuses anything that would swallow the appended path', () => {
    for (const value of [
      'http://qdrant:6333/collections/x/snapshots?',
      'http://qdrant:6333/collections/x/snapshots?a=b',
      'http://host.docker.internal:11434#',
      'http://user:pw@host.docker.internal:11434',
      'file:///etc/passwd',
      'not-a-url',
    ]) {
      expect(isRuntimeBaseUrl(value)).toBe(false);
    }
  });
});

describe('runtimeFetcher', () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  test('admits loopback and LAN, refuses cloud metadata and a malformed base', async () => {
    await expect(runtimeFetcher('http://127.0.0.1:11434')).resolves.toBeFunction();
    await expect(runtimeFetcher('http://192.168.1.50:11434')).resolves.toBeFunction();
    for (const value of [
      'http://169.254.169.254',
      'http://[::ffff:169.254.169.254]:11434',
      'http://100.100.100.200',
      'http://127.0.0.1:11434?',
    ]) {
      await expect(runtimeFetcher(value)).rejects.toThrow();
    }
  });

  // The check and the connection used to resolve the name separately, so its
  // DNS could answer the second time with an address the first never saw.
  // `pinned.invalid` resolves nowhere: reaching the server at all means the
  // connection went to the checked address without a second lookup, and the
  // Host header shows the name was kept for the far side.
  test('connects to the checked address under the name the URL carries', async () => {
    const hosts: Array<string | null> = [];
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        hosts.push(req.headers.get('host'));
        return Response.json({ ok: true });
      },
    });
    const fetcher = await runtimeFetcher(`http://127.0.0.1:${server.port}`);

    const res = await fetcher(`http://pinned.invalid:${server.port}/v1/models`);

    expect(await res.json()).toEqual({ ok: true });
    expect(hosts).toEqual([`pinned.invalid:${server.port}`]);
  });

  test('sends the method, headers and body, and hands back status, headers and body', async () => {
    let seen: { method: string; type: string | null; body: string } | undefined;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        seen = {
          method: req.method,
          type: req.headers.get('content-type'),
          body: await req.text(),
        };
        return new Response('data: [DONE]\n\n', {
          status: 201,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const fetcher = await runtimeFetcher(base);

    const res = await fetcher(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"model":"m"}',
    });

    expect(seen).toEqual({ method: 'POST', type: 'application/json', body: '{"model":"m"}' });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toBe('data: [DONE]\n\n');
  });

  // node:http names the address it could not reach, and the message goes on
  // into tool results a peer's turn can repeat.
  test('fails a refused connection without naming the address', async () => {
    const fetcher = await runtimeFetcher('http://127.0.0.1:1');
    const error = await fetcher('http://127.0.0.1:1/v1/models').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('127.0.0.1');
  });

  // The embedding path bounds every call with a signal; a runtime that accepts
  // the connection and never answers must not hold it past that.
  test('gives up when the signal aborts', async () => {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    });
    const base = `http://127.0.0.1:${server.port}`;
    const fetcher = await runtimeFetcher(base);

    await expect(
      fetcher(`${base}/v1/models`, { signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow();
  });

  // A Response cannot carry this status, and the callback that builds one runs
  // outside any promise chain — a throw there would be an uncaught exception.
  test('fails the call, not the process, on a status a Response cannot carry', async () => {
    const raw = net.createServer((socket) => {
      socket.once('data', () => socket.end('HTTP/1.1 600 Odd\r\ncontent-length: 0\r\n\r\n'));
    });
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));
    const { port } = raw.address() as net.AddressInfo;
    try {
      const fetcher = await runtimeFetcher(`http://127.0.0.1:${port}`);
      await expect(fetcher(`http://127.0.0.1:${port}/v1/models`)).rejects.toThrow();
    } finally {
      raw.close();
    }
  });
});

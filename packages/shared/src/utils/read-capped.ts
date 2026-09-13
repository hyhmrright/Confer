/**
 * Read a response body as text, refusing to buffer more than `limit` bytes.
 *
 * `fetch` resolves once the headers land, so nothing about the call bounds what
 * follows: `res.json()` buffers whatever the host sends, for as long as it cares
 * to send it. The cap has to be enforced while reading — checking Content-Length
 * trusts the sender to describe itself, and checking the finished string means
 * the memory was already spent.
 */
export async function readCappedText(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('response too large');
      chunks.push(value);
    }
  } finally {
    // Drops the connection rather than letting the rest arrive unread.
    await reader.cancel().catch(() => {});
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(body);
}

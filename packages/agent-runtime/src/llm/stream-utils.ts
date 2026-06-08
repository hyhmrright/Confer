/**
 * Shared SSE line-buffer reader.
 *
 * Reads a streaming HTTP response body, decodes it incrementally, splits on
 * newlines while keeping any trailing partial line buffered, and yields the
 * payload of each `data: ` line (with the `data: ` prefix stripped).
 *
 * Provider-specific event-type handling (e.g. Anthropic `content_block_delta`
 * vs OpenAI `delta`/`tool_calls`, `message_stop` vs `[DONE]`) stays in each
 * provider's `stream()` — this only owns the transport-level framing.
 */
export async function* readSSEData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      yield line.slice(6);
    }
  }
}

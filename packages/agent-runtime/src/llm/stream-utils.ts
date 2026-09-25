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
// Longer than any real event. The far side decides when a newline comes, and
// one that never sends it was buffered until the process ran out of memory —
// for a local runtime, that side is any host the owner can name.
const MAX_LINE_CHARS = 1024 * 1024;

// The most of a non-streamed reply either provider reads into memory. A
// completion stops at max_tokens, so this is generous; without it the far side
// decided how much this process buffered.
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_ERROR_BYTES = 16 * 1024;

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
    if (buffer.length > MAX_LINE_CHARS) {
      await reader.cancel();
      throw new Error('Stream sent a line longer than any event');
    }

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      yield line.slice(6);
    }
  }
}

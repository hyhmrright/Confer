import { describe, expect, test } from 'bun:test';
import { chunkText } from './chunker.js';

const META = ['doc-1', 'guide.md', 'kb-1', 'user-1'] as const;

describe('chunkText', () => {
  test('returns no chunks for empty or whitespace-only text', () => {
    expect(chunkText('', ...META)).toEqual([]);
    expect(chunkText('   \n\t  ', ...META)).toEqual([]);
  });

  test('produces a single chunk for text under the chunk size', () => {
    const chunks = chunkText('hello world', ...META);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      doc_id: 'doc-1',
      doc_name: 'guide.md',
      kb_id: 'kb-1',
      user_id: 'user-1',
      text: 'hello world',
      chunk_index: 0,
    });
    expect(chunks[0]?.chunk_id).toBeTruthy();
  });

  test('normalizes CRLF and trims surrounding whitespace', () => {
    const chunks = chunkText('  line1\r\nline2  ', ...META);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('line1\nline2');
  });

  test('splits long text into overlapping chunks with incrementing index', () => {
    // 2000 chars > CHUNK_SIZE (800); step is 800-100=700, so starts at 0,700,1400.
    const text = 'a'.repeat(2000);
    const chunks = chunkText(text, ...META);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1, 2]);
    expect(chunks[0]?.text).toHaveLength(800);
    // Last chunk runs to the end of the input.
    expect(chunks[2]?.text.length).toBeGreaterThan(0);
    expect(chunks[2]?.text.length).toBeLessThanOrEqual(800);
    // Consecutive chunks overlap by OVERLAP (100) characters.
    const tailOfFirst = chunks[0]?.text.slice(-100);
    expect(chunks[1]?.text.startsWith(tailOfFirst ?? 'x')).toBe(true);
  });

  test('assigns a unique chunk_id per chunk', () => {
    const chunks = chunkText('b'.repeat(2000), ...META);
    const ids = new Set(chunks.map((c) => c.chunk_id));
    expect(ids.size).toBe(chunks.length);
  });
});

import { describe, expect, test } from 'bun:test';
import { chunkText } from './chunker.js';

const META = ['doc-1', 'guide.md', 'kb-1', 'user-1'] as const;
// Mirrors the module's OVERLAP constant (chunks carry this many tail chars).
const OVERLAP_HINT = 100;

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

  test('no chunk exceeds CHUNK_SIZE (800)', () => {
    // Mixed content: long paragraphs, Chinese sentences, and an unbroken run.
    const text = `${'句子。'.repeat(400)}\n\n${'word '.repeat(400)}\n\n${'x'.repeat(1500)}`;
    const chunks = chunkText(text, ...META);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(800);
    }
    expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
  });

  test('prefers paragraph boundaries over cutting mid-paragraph', () => {
    // Two paragraphs that together exceed CHUNK_SIZE but individually fit, so
    // the split should fall on the blank-line boundary between them.
    const para1 = `${'A'.repeat(500)}`;
    const para2 = `${'B'.repeat(500)}`;
    const chunks = chunkText(`${para1}\n\n${para2}`, ...META);
    expect(chunks).toHaveLength(2);
    // Each chunk stays within a single paragraph — no chunk mixes A and B.
    expect(chunks[0]?.text.includes('B')).toBe(false);
    expect(chunks[1]?.text.includes('A')).toBe(false);
  });

  test('breaks on Chinese sentence punctuation rather than mid-sentence', () => {
    // Sentences sized so two fit per chunk but the third spills to the next.
    const sentence = `${'中'.repeat(300)}。`;
    const chunks = chunkText(sentence.repeat(4), ...META);
    expect(chunks.length).toBeGreaterThan(1);
    // Every non-final chunk should end at a sentence boundary (。), never mid-sentence.
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]?.text.endsWith('。')).toBe(true);
    }
  });

  test('consecutive chunks overlap for context continuity', () => {
    // An unbroken run forces the hard-cut path, whose merge carries overlap.
    const text = Array.from({ length: 2000 }, (_, i) => String(i % 10)).join('');
    const chunks = chunkText(text, ...META);
    expect(chunks.length).toBeGreaterThan(1);
    // The tail of one chunk reappears at the head of the next.
    const tail = chunks[0]?.text.slice(-OVERLAP_HINT) ?? '';
    expect(tail.length).toBeGreaterThan(0);
    expect(chunks[1]?.text.startsWith(tail)).toBe(true);
  });

  test('assigns a unique chunk_id per chunk and increments index', () => {
    const chunks = chunkText('b'.repeat(2000), ...META);
    const ids = new Set(chunks.map((c) => c.chunk_id));
    expect(ids.size).toBe(chunks.length);
    expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
  });
});

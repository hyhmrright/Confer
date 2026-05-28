import { describe, expect, test } from 'bun:test';
import { guessContentType, parseDocument } from './doc-parser.js';

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('guessContentType', () => {
  test('maps known extensions to MIME types', () => {
    expect(guessContentType('readme.md')).toBe('text/markdown');
    expect(guessContentType('report.pdf')).toBe('application/pdf');
  });

  test('is case-insensitive on the extension', () => {
    expect(guessContentType('README.MD')).toBe('text/markdown');
  });

  test('defaults unknown or extensionless names to text/plain', () => {
    expect(guessContentType('notes.txt')).toBe('text/plain');
    expect(guessContentType('Makefile')).toBe('text/plain');
  });
});

describe('parseDocument', () => {
  test('decodes plain text and markdown buffers', async () => {
    expect(await parseDocument(encode('hello world'), 'text/plain')).toBe('hello world');
    expect(await parseDocument(encode('# Title'), 'text/markdown')).toBe('# Title');
  });

  test('ignores charset parameters on the content type', async () => {
    expect(await parseDocument(encode('body'), 'text/plain; charset=utf-8')).toBe('body');
  });

  test('rejects unsupported content types', async () => {
    await expect(parseDocument(encode('x'), 'image/png')).rejects.toThrow('Unsupported file type');
  });
});

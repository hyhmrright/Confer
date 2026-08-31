import { describe, expect, test } from 'bun:test';
import { guessContentType, isSupportedDocumentType, parseDocument } from './doc-parser.js';
import { MAX_EXTRACTED_CHARS } from './rag-config.js';

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('guessContentType', () => {
  test('maps known extensions to MIME types', () => {
    expect(guessContentType('readme.md')).toBe('text/markdown');
    expect(guessContentType('report.pdf')).toBe('application/pdf');
    expect(guessContentType('report.docx')).toBe(DOCX_TYPE);
    expect(guessContentType('books.xlsx')).toBe(XLSX_TYPE);
  });

  test('is case-insensitive on the extension', () => {
    expect(guessContentType('README.MD')).toBe('text/markdown');
  });

  test('defaults unknown or extensionless names to text/plain', () => {
    expect(guessContentType('notes.txt')).toBe('text/plain');
    expect(guessContentType('Makefile')).toBe('text/plain');
  });
});

// A real PDF from a real producer, for the same reason `office-parser.test.ts`
// carries a real .docx: the PDF branch shipped broken (pdf-parse 2.x exports a
// class, and the code called the package object as a function) behind a suite
// whose only PDF assertion was `guessContentType('report.pdf')` — a filename
// map that never reaches a parser.
const PDF_FIXTURE = new URL('../test/fixtures/sample.pdf', import.meta.url);

describe('parseDocument', () => {
  test('extracts text from a real PDF', async () => {
    const text = await parseDocument(await Bun.file(PDF_FIXTURE).arrayBuffer(), 'application/pdf');
    expect(text).toContain('Confer knowledge base ingestion probe');
    expect(text).toContain('exercised');
  });

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

  test('truncates text past the extraction cap', async () => {
    const oversized = 'a'.repeat(MAX_EXTRACTED_CHARS + 1000);
    const text = await parseDocument(encode(oversized), 'text/plain');
    // The upload cap bounds compressed bytes; docx/xlsx are zip archives, so
    // nothing else stands between one upload and hundreds of thousands of
    // embedding calls.
    expect(text).toHaveLength(MAX_EXTRACTED_CHARS);
  });

  test('leaves text under the cap untouched', async () => {
    const text = await parseDocument(encode('short'), 'text/plain');
    expect(text).toBe('short');
  });
});

describe('isSupportedDocumentType', () => {
  test('admits the office formats the parser can read', () => {
    expect(isSupportedDocumentType(DOCX_TYPE)).toBe(true);
    expect(isSupportedDocumentType(XLSX_TYPE)).toBe(true);
  });

  test('still rejects the legacy binary formats, which the parser cannot read', () => {
    // .doc/.xls are a different container entirely. The upload route asks this
    // before writing to storage, so admitting one here would park bytes in the
    // bucket for a document that can only ever end at `failed`.
    expect(isSupportedDocumentType('application/msword')).toBe(false);
    expect(isSupportedDocumentType('application/vnd.ms-excel')).toBe(false);
  });
});

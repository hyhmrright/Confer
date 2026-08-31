import { AppError } from '@confer/shared';
import { PDFParse } from 'pdf-parse';
import { extractDocxText, extractXlsxText } from './office-parser.js';
import { MAX_EXTRACTED_CHARS } from './rag-config.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SUPPORTED_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/pdf',
  DOCX_TYPE,
  XLSX_TYPE,
]);

/**
 * Whether a document of this content type can be ingested at all.
 *
 * Exported so the upload route can ask before it writes: parsing happens
 * asynchronously after the response is sent, so a type this rejects used to be
 * discovered only once the file was already in object storage and a row already
 * written. Any authenticated account could therefore park 10 MB of arbitrary
 * bytes per request in the bucket, of any type, and the only trace was a
 * document stuck at `failed`.
 */
export function isSupportedDocumentType(contentType: string): boolean {
  return SUPPORTED_TYPES.has(baseContentType(contentType));
}

// The media type without its parameters — `text/plain; charset=utf-8` is a
// plain-text file.
function baseContentType(contentType: string): string {
  return (contentType.split(';')[0] ?? contentType).trim();
}

export async function parseDocument(buffer: ArrayBuffer, contentType: string): Promise<string> {
  const base = baseContentType(contentType);

  if (!SUPPORTED_TYPES.has(base)) {
    throw new AppError('unsupported_format', `Unsupported file type: ${base}`, 400);
  }

  return capExtractedText(await extract(buffer, base), base);
}

async function extract(buffer: ArrayBuffer, base: string): Promise<string> {
  if (base === 'text/plain' || base === 'text/markdown') {
    return new TextDecoder().decode(buffer);
  }
  if (base === DOCX_TYPE) return extractDocxText(buffer);
  if (base === XLSX_TYPE) return extractXlsxText(buffer);

  return extractPdfText(buffer);
}

/**
 * Text out of a PDF.
 *
 * pdf-parse 2.x exports a `PDFParse` class and no callable default; this called
 * the package object as a function, so every PDF upload failed with "pdfParse is
 * not a function" — in a background task, after the file was already stored, so
 * the only symptom was a document stuck at `failed`. Nothing caught it because
 * the only PDF assertion in the suite was `guessContentType('report.pdf')`,
 * which tests the filename map and never reaches a parser.
 *
 * `destroy()` is in a `finally` because the parser holds the loaded document
 * until it is called, and this runs in a background task in a process that
 * stays up for weeks — a throwing parse must not be the one that keeps it.
 */
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

/**
 * Bound what one document contributes downstream.
 *
 * The upload route caps the upload at 10 MB, but the two OOXML formats are zip
 * archives, so that bounds the compressed bytes and not the text — and nothing
 * after this point has a ceiling of its own: `chunkText` splits whatever it
 * receives into 800-char chunks, each of which costs an embedding call and a
 * Qdrant point. Truncating loses the tail of an implausibly large document;
 * not truncating lets one upload spend the owner's embedding budget.
 *
 * This runs *after* extraction, so it is a ceiling on downstream cost and not
 * on the memory the parse took to get here — see MAX_EXTRACTED_CHARS.
 *
 * Logged rather than thrown: the document still ingests, and a silent cut is
 * exactly the kind of thing that is impossible to diagnose later.
 */
function capExtractedText(text: string, base: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  console.warn(
    `document text truncated: type=${base} extracted=${text.length} cap=${MAX_EXTRACTED_CHARS}`,
  );
  return text.slice(0, MAX_EXTRACTED_CHARS);
}

export function guessContentType(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'md':
      return 'text/markdown';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return DOCX_TYPE;
    case 'xlsx':
      return XLSX_TYPE;
    default:
      return 'text/plain';
  }
}

// pdf-parse ships CJS only; use createRequire for Bun ESM compatibility
import { createRequire } from 'node:module';
import { AppError } from '@confer/shared';

const pdfParse = createRequire(import.meta.url)('pdf-parse') as (
  buf: Buffer,
) => Promise<{ text: string }>;

const SUPPORTED_TYPES = new Set(['text/plain', 'text/markdown', 'application/pdf']);

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

  if (base === 'text/plain' || base === 'text/markdown') {
    return new TextDecoder().decode(buffer);
  }

  const data = await pdfParse(Buffer.from(buffer));
  return data.text;
}

export function guessContentType(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'md':
      return 'text/markdown';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'text/plain';
  }
}

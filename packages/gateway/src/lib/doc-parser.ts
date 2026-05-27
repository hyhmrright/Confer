import { AppError } from '@confer/shared';
// pdf-parse ships CJS only; use createRequire for Bun ESM compatibility
import { createRequire } from 'module';
const pdfParse = createRequire(import.meta.url)('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const SUPPORTED_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/pdf',
]);

export async function parseDocument(buffer: ArrayBuffer, contentType: string): Promise<string> {
  const base = (contentType.split(';')[0] ?? contentType).trim();

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
    case 'md': return 'text/markdown';
    case 'pdf': return 'application/pdf';
    default: return 'text/plain';
  }
}

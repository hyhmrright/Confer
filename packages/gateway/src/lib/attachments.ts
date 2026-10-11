import { createHash } from 'node:crypto';
import type { LLMImage } from '@confer/agent-runtime';
import { AppError, newId } from '@confer/shared';
import { inArray } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { attachments } from '../db/schema.js';
import { guessContentType, isSupportedDocumentType, parseDocument } from './doc-parser.js';
import { getObject, putObject } from './storage.js';

// Files a user sends with a chat message. Images go to the model as images;
// documents are read once, at upload, and their text rides along with the
// message on every turn that still has it in its history window.

/** Anthropic's per-image ceiling, and a sane one for every other vendor. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** The knowledge-base upload's ceiling, for the same parsers. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/**
 * How much of one document's text reaches a prompt. The parser's own cap
 * bounds memory; this bounds context — a 300-page PDF inlined whole would
 * crowd the conversation out of every vendor's window.
 */
const MAX_PROMPT_CHARS_PER_DOCUMENT = 50_000;

// The four formats every vision API accepts, recognised by their bytes rather
// than the browser's claim. SVG is deliberately absent: it is a document that
// can carry script, and the content route serves images inline.
const IMAGE_SIGNATURES: Array<{ type: string; matches: (b: Uint8Array) => boolean }> = [
  { type: 'image/png', matches: (b) => hasBytes(b, 0, [0x89, 0x50, 0x4e, 0x47]) },
  { type: 'image/jpeg', matches: (b) => hasBytes(b, 0, [0xff, 0xd8, 0xff]) },
  { type: 'image/gif', matches: (b) => hasBytes(b, 0, [0x47, 0x49, 0x46, 0x38]) },
  {
    type: 'image/webp',
    matches: (b) =>
      hasBytes(b, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(b, 8, [0x57, 0x45, 0x42, 0x50]),
  },
];

function hasBytes(buf: Uint8Array, offset: number, bytes: number[]): boolean {
  return bytes.every((byte, i) => buf[offset + i] === byte);
}

/** The image type these bytes really are, or null if they are not one we take. */
export function sniffImageType(buf: Uint8Array): string | null {
  return IMAGE_SIGNATURES.find((s) => s.matches(buf))?.type ?? null;
}

export function isImageType(contentType: string | null): boolean {
  return IMAGE_SIGNATURES.some((s) => s.type === contentType);
}

const textKey = (key: string) => `${key}.txt`;

/**
 * Whether bytes claimed as text are text. An unknown extension is guessed as
 * `text/plain`, so without this an executable would be "read" into the prompt
 * as mojibake; real text is valid UTF-8 and has no NUL bytes.
 */
function readableAs(contentType: string, bytes: Uint8Array): boolean {
  if (!contentType.startsWith('text/')) return true;
  try {
    return !new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0');
  } catch {
    return false;
  }
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
}

/**
 * Validate, store, and (for a document) read one uploaded file. The row starts
 * unbound; sending a message claims it. Throws a 400 `AppError` for anything
 * the turn could not use, before a byte is written.
 */
export async function storeAttachment(userId: string, file: File): Promise<AttachmentMeta> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = sniffImageType(bytes);
  // The browser's type when it names a document we read; otherwise the
  // extension's. Browsers call a `.ts` source file `video/mp2t`.
  const contentType =
    image ?? (isSupportedDocumentType(file.type) ? file.type : guessContentType(file.name));

  if (!image && (!isSupportedDocumentType(contentType) || !readableAs(contentType, bytes))) {
    throw new AppError(
      'unsupported_format',
      `Unsupported file type: ${file.type || file.name}`,
      400,
    );
  }
  const limit = image ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (bytes.byteLength > limit) {
    throw new AppError('file_too_large', `File too large (max ${limit / 1024 / 1024}MB)`, 400);
  }

  // Parse before storing, so a document no parser can read is refused rather
  // than kept as bytes no turn will ever see.
  const text = image ? null : await parseDocument(bytes.buffer, contentType);

  const id = newId();
  const key = `attachments/${userId}/${id}`;
  await putObject(key, Buffer.from(bytes), contentType);
  if (text !== null) {
    await putObject(textKey(key), Buffer.from(text, 'utf-8'), 'text/plain; charset=utf-8');
  }

  const [row] = await getDb()
    .insert(attachments)
    .values({
      id,
      user_id: userId,
      filename: file.name.slice(0, 255) || 'file',
      content_type: contentType,
      size_bytes: bytes.byteLength,
      storage_url: key,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    .returning();
  if (!row) throw new AppError('attachment_failed', 'Failed to store attachment', 500);
  return toMeta(row);
}

export function toMeta(row: typeof attachments.$inferSelect): AttachmentMeta {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
  };
}

/** Each message's attachments, for showing them. */
export async function attachmentsByMessage(
  messageIds: string[],
): Promise<Map<string, AttachmentMeta[]>> {
  const byMessage = new Map<string, AttachmentMeta[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await getDb()
    .select()
    .from(attachments)
    .where(inArray(attachments.message_id, messageIds))
    .orderBy(attachments.id);
  for (const row of rows) {
    if (!row.message_id) continue;
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), toMeta(row)]);
  }
  return byMessage;
}

export interface TurnAttachments {
  images: LLMImage[];
  /** Each document's text, wrapped so the model can tell it from the message. */
  text: string;
}

/** What each message's attachments contribute to a model turn. */
export async function turnAttachments(messageIds: string[]): Promise<Map<string, TurnAttachments>> {
  const byMessage = new Map<string, TurnAttachments>();
  if (messageIds.length === 0) return byMessage;
  const rows = await getDb()
    .select()
    .from(attachments)
    .where(inArray(attachments.message_id, messageIds))
    .orderBy(attachments.id);

  for (const row of rows) {
    if (!row.message_id) continue;
    const entry = byMessage.get(row.message_id) ?? { images: [], text: '' };
    if (isImageType(row.content_type)) {
      const data = (await getObject(row.storage_url)).toString('base64');
      entry.images.push({ media_type: row.content_type as string, data });
    } else {
      const text = (await getObject(textKey(row.storage_url))).toString('utf-8');
      // The filename is the uploader's own text and the body is a document's:
      // neither may close the tag early and pass for the user speaking.
      const name = row.filename.replace(/[<>"\n]/g, '');
      const body = text.slice(0, MAX_PROMPT_CHARS_PER_DOCUMENT).replaceAll('</attachment>', '');
      entry.text += `\n\n<attachment name="${name}">\n${body}\n</attachment>`;
    }
    byMessage.set(row.message_id, entry);
  }
  return byMessage;
}

/** The storage keys an attachment row owns, for deleting it. */
export function storageKeys(row: { storage_url: string; content_type: string | null }): string[] {
  return isImageType(row.content_type)
    ? [row.storage_url]
    : [row.storage_url, textKey(row.storage_url)];
}

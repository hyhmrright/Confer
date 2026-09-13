import { inflateRawSync } from 'node:zlib';
import { MAX_OOXML_ENTRIES, MAX_OOXML_MARKUP, MAX_OOXML_TOTAL_BYTES } from './rag-config.js';

const END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const LESS_THAN = 0x3c;
const EQUALS = 0x3d;

class OoxmlBudgetError extends Error {}

/**
 * Refuse a .docx/.xlsx that would inflate past the OOXML budgets in
 * rag-config.ts, before mammoth or exceljs is handed it.
 *
 * The sizes an archive declares are the sender's claim, so every entry is
 * actually inflated, each against what is left of the byte budget — zlib's
 * `maxOutputLength` stops at the limit rather than after it — and its markup is
 * counted. That is a second decompression of a file the upload route already
 * caps at 10 MB, bounded by the budgets themselves.
 *
 * Markup is counted in every entry, not just the ones named `.xml`: mammoth
 * finds its parts through relationships, so the main document can be called
 * anything, and its parser records errors but finishes building the tree before
 * it throws, so being invalid XML protects nothing either.
 *
 * The walk has to find the same entries the parsers' zip reader (JSZip) does,
 * or a bomb could sit behind a harmless directory only this code reads. So it
 * takes the same path — end record, central directory, local header — and
 * refuses what JSZip would reinterpret: a central directory that does not end
 * where the end record sits, which JSZip answers by shifting every offset, and
 * ZIP64, which nothing under the upload cap needs.
 */
export function assertOoxmlWithinBudget(archive: ArrayBuffer): void {
  try {
    walk(Buffer.from(archive));
  } catch (e) {
    if (e instanceof OoxmlBudgetError) throw e;
    throw new Error('Not a readable .docx/.xlsx archive');
  }
}

function walk(zip: Buffer): void {
  const end = zip.lastIndexOf(END_OF_CENTRAL_DIRECTORY);
  if (end < 0) throw new Error('no end of central directory');
  // A 16-bit field at its maximum sends JSZip looking for a ZIP64 record this
  // walk does not read. (A 32-bit one cannot pass the position check below.)
  for (const field of [4, 6, 8, 10]) {
    if (zip.readUInt16LE(end + field) === 0xffff) throw new Error('zip64');
  }
  const entries = zip.readUInt16LE(end + 10);
  const directorySize = zip.readUInt32LE(end + 12);
  let at = zip.readUInt32LE(end + 16);
  if (at + directorySize !== end) throw new Error('central directory is not where it says');

  let total = 0;
  let markup = 0;
  let walked = 0;
  // By record, up to the end record — not by the count the end record declares.
  // JSZip reads on for as long as the signatures continue, so a count of 1 in
  // front of two records hid the second from a loop bound by the count.
  while (at < end) {
    if (++walked > MAX_OOXML_ENTRIES) throw tooLarge();
    if (zip.readUInt32LE(at) !== CENTRAL_FILE_HEADER) throw new Error('bad central header');
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const local = zip.readUInt32LE(at + 42);
    at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);

    if (zip.readUInt32LE(local) !== LOCAL_FILE_HEADER) throw new Error('bad local header');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compressedSize);
    if (data.length !== compressedSize) throw new Error('truncated entry');

    const content = inflate(method, data, MAX_OOXML_TOTAL_BYTES - total);
    total += content.length;
    markup += countMarkup(content, MAX_OOXML_MARKUP - markup);
  }
  if (at !== end || walked !== entries) {
    throw new Error('central directory does not match its end record');
  }
}

function inflate(method: number, data: Buffer, room: number): Buffer {
  let content: Buffer;
  if (method === STORED) {
    content = data;
  } else if (method === DEFLATED) {
    try {
      content = inflateRawSync(data, { maxOutputLength: Math.max(1, room) });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge();
      throw e;
    }
  } else {
    throw new Error('unsupported compression method');
  }
  if (content.length > room) throw tooLarge();
  return content;
}

// Every element, end tag, comment and processing instruction opens with `<`,
// and every attribute carries an `=`, so together they bound the nodes a parser
// can build. Binary parts such as images hold them only by chance, about one
// byte in 128, which leaves a document that is mostly pictures well inside.
function countMarkup(content: Buffer, room: number): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    const byte = content[i];
    if (byte === LESS_THAN || byte === EQUALS) {
      count++;
      if (count > room) throw tooLarge();
    }
  }
  return count;
}

function tooLarge(): OoxmlBudgetError {
  return new OoxmlBudgetError('Document expands past what can be parsed safely');
}

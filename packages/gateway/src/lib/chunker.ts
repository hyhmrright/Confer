import { newId } from '@confer/shared';

const CHUNK_SIZE = 800;
const OVERLAP = 100;

// Separator cascade, highest priority first: paragraph → line → sentence-ending
// punctuation (Chinese included, since Chinese has no inter-word spaces) →
// whitespace → hard character split. A separator is kept attached to the end of
// its preceding piece so sentence boundaries survive reassembly.
const SEPARATORS = ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ', ''];

export interface Chunk {
  chunk_id: string;
  doc_id: string;
  doc_name: string;
  kb_id: string;
  user_id: string;
  text: string;
  chunk_index: number;
}

export function chunkText(
  text: string,
  docId: string,
  docName: string,
  kbId: string,
  userId: string,
): Chunk[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  return splitRecursive(cleaned, SEPARATORS).map((chunk, index) => ({
    chunk_id: newId(),
    doc_id: docId,
    doc_name: docName,
    kb_id: kbId,
    user_id: userId,
    text: chunk,
    chunk_index: index,
  }));
}

// Split `text` into pieces bounded by CHUNK_SIZE, preferring the highest-priority
// separator that appears in the text and recursing into any piece still too
// large. Small pieces are greedily merged (with overlap) back up to CHUNK_SIZE.
function splitRecursive(text: string, separators: string[]): string[] {
  let separator = separators[separators.length - 1] as string;
  let remaining: string[] = [];
  for (let i = 0; i < separators.length; i++) {
    const s = separators[i] as string;
    if (s === '') {
      separator = s;
      break;
    }
    if (text.includes(s)) {
      separator = s;
      remaining = separators.slice(i + 1);
      break;
    }
  }

  const finalChunks: string[] = [];
  let goodSplits: string[] = [];
  for (const piece of splitKeepingSeparator(text, separator)) {
    if (piece.length <= CHUNK_SIZE) {
      goodSplits.push(piece);
      continue;
    }
    if (goodSplits.length > 0) {
      finalChunks.push(...mergeWithOverlap(goodSplits));
      goodSplits = [];
    }
    // Still too big: recurse with the finer separators, or accept as-is once the
    // hard character split ('') has been exhausted (unreachable in practice —
    // single characters never exceed CHUNK_SIZE).
    if (remaining.length === 0) finalChunks.push(piece);
    else finalChunks.push(...splitRecursive(piece, remaining));
  }
  if (goodSplits.length > 0) finalChunks.push(...mergeWithOverlap(goodSplits));
  return finalChunks;
}

// Split on `separator` but keep it attached to the end of each preceding piece,
// so joining the pieces reproduces the source and punctuation stays with its
// sentence. An empty separator splits into individual characters (hard cut).
function splitKeepingSeparator(text: string, separator: string): string[] {
  if (separator === '') return text.split('');

  const parts: string[] = [];
  let start = 0;
  for (let idx = text.indexOf(separator, start); idx !== -1; idx = text.indexOf(separator, start)) {
    parts.push(text.slice(start, idx + separator.length));
    start = idx + separator.length;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.filter((p) => p !== '');
}

// Greedily pack pieces (already carrying their separators, so joined with '')
// into chunks up to CHUNK_SIZE, carrying ~OVERLAP characters of the previous
// chunk's tail into the next for context continuity.
function mergeWithOverlap(pieces: string[]): string[] {
  const chunks: string[] = [];
  const current: string[] = [];
  let total = 0;

  for (const piece of pieces) {
    if (total + piece.length > CHUNK_SIZE && current.length > 0) {
      const merged = current.join('').trim();
      if (merged) chunks.push(merged);
      // Drop from the front until we're back under the overlap budget (and the
      // incoming piece fits), retaining the tail as leading overlap.
      while (total > OVERLAP || (total + piece.length > CHUNK_SIZE && total > 0)) {
        total -= (current.shift() as string).length;
      }
    }
    current.push(piece);
    total += piece.length;
  }

  const merged = current.join('').trim();
  if (merged) chunks.push(merged);
  return chunks;
}

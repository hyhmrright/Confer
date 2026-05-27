import { newId } from '@confer/shared';

const CHUNK_SIZE = 800;
const OVERLAP = 100;

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

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < cleaned.length) {
    const end = Math.min(start + CHUNK_SIZE, cleaned.length);
    const chunkText = cleaned.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        chunk_id: newId(),
        doc_id: docId,
        doc_name: docName,
        kb_id: kbId,
        user_id: userId,
        text: chunkText,
        chunk_index: index++,
      });
    }

    if (end === cleaned.length) break;
    start = end - OVERLAP;
  }

  return chunks;
}

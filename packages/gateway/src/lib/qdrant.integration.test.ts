import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import {
  deleteByKbId,
  ensureCollection,
  type KnowledgeChunk,
  searchChunks,
  upsertChunks,
} from './qdrant.js';
import { VECTOR_SIZE } from './rag-config.js';
import type { TextLang } from './text-lang.js';

// Cross-lingual slots run a SECOND vector query against the same collection.
// The thing that has to be true of it is not that it finds documents — it is
// that it cannot find documents the primary search was forbidden from
// returning. These tests exist for that.

const OWNER = 'owner00000000000000000001';
const OTHER_OWNER = 'owner00000000000000000002';
const KB = 'kb0000000000000000000001';
const OTHER_KB = 'kb0000000000000000000002';

/**
 * Vectors that are close (for the query) or far, deterministically.
 *
 * `bias` shifts a single dimension, so cosine similarity orders the points
 * predictably without depending on a real embedding model.
 */
function vec(bias: number): number[] {
  const v = new Array(VECTOR_SIZE).fill(0.01);
  v[0] = bias;
  return v;
}

function chunk(over: Partial<KnowledgeChunk> & { lang: TextLang; bias: number }): KnowledgeChunk {
  const { bias, ...rest } = over;
  return {
    chunk_id: newId(),
    kb_id: KB,
    kb_name: 'KB',
    doc_id: newId(),
    doc_name: 'doc.md',
    user_id: OWNER,
    text: 'body',
    chunk_index: 0,
    vector: vec(bias),
    provider: 'openai',
    ...rest,
  };
}

const QUERY = vec(1);

beforeEach(async () => {
  await ensureCollection();
  await deleteByKbId(KB);
  await deleteByKbId(OTHER_KB);
});

describe('searchChunks cross-lingual slots', () => {
  test('surfaces an other-language document the primary ranking buried', async () => {
    // Five Chinese chunks all score above the English one, so a top-3 search
    // returns only Chinese — the exact shape measured on the eval corpus, where
    // the right English document sat at rank 7, 15 and 19.
    await upsertChunks([
      ...Array.from({ length: 5 }, (_, i) =>
        chunk({ lang: 'zh', bias: 0.9 - i * 0.01, doc_name: `zh-${i}.md` }),
      ),
      chunk({ lang: 'en', bias: 0.2, doc_name: 'en.md' }),
    ]);

    const without = await searchChunks(QUERY, OWNER, [KB], 3, 'openai');
    expect(without.map((r) => r.doc_name)).not.toContain('en.md');

    const withSlots = await searchChunks(QUERY, OWNER, [KB], 3, 'openai', undefined, {
      queryLang: 'zh',
      slots: 2,
    });
    expect(withSlots.map((r) => r.doc_name)).toContain('en.md');
  });

  test('leaves the primary ranking untouched', async () => {
    await upsertChunks([
      ...Array.from({ length: 3 }, (_, i) =>
        chunk({ lang: 'zh', bias: 0.9 - i * 0.01, doc_name: `zh-${i}.md` }),
      ),
      chunk({ lang: 'en', bias: 0.2, doc_name: 'en.md' }),
    ]);

    const base = await searchChunks(QUERY, OWNER, [KB], 3, 'openai');
    const withSlots = await searchChunks(QUERY, OWNER, [KB], 3, 'openai', undefined, {
      queryLang: 'zh',
      slots: 2,
    });

    // Additive, never a re-ranking: the first three results are the same three
    // in the same order, and the extras come after.
    expect(withSlots.slice(0, 3).map((r) => r.doc_name)).toEqual(base.map((r) => r.doc_name));
  });

  test("never returns another owner's chunks through the extra query", async () => {
    // The one that matters. The supplementary search must carry every filter
    // the primary one does; if it built a fresh filter list it would read
    // across tenants, and it returns document text to the caller.
    await upsertChunks([
      chunk({ lang: 'zh', bias: 0.9 }),
      chunk({ lang: 'en', bias: 0.8, user_id: OTHER_OWNER, doc_name: 'other-owner.md' }),
    ]);

    const results = await searchChunks(QUERY, OWNER, [KB], 5, 'openai', undefined, {
      queryLang: 'zh',
      slots: 3,
    });
    expect(results.map((r) => r.doc_name)).not.toContain('other-owner.md');
  });

  test('never reaches outside the knowledge-base scope through the extra query', async () => {
    // Same property against kb scope, which is what bounds an inbound A2A turn
    // to the bases the owner marked shareable.
    await upsertChunks([
      chunk({ lang: 'zh', bias: 0.9 }),
      chunk({ lang: 'en', bias: 0.8, kb_id: OTHER_KB, doc_name: 'other-kb.md' }),
    ]);

    const results = await searchChunks(QUERY, OWNER, [KB], 5, 'openai', undefined, {
      queryLang: 'zh',
      slots: 3,
    });
    expect(results.map((r) => r.doc_name)).not.toContain('other-kb.md');
  });

  test('does not duplicate a chunk both queries matched', async () => {
    await upsertChunks([chunk({ lang: 'en', bias: 0.9, doc_name: 'en.md' })]);

    const results = await searchChunks(QUERY, OWNER, [KB], 5, 'openai', undefined, {
      queryLang: 'zh',
      slots: 3,
    });
    expect(results).toHaveLength(1);
  });

  test('ignores points indexed before lang existed', async () => {
    // Their language is unknown, so they must not occupy a cross-lingual slot;
    // they already competed in the primary search. Written without `lang` the
    // way every pre-existing point is.
    const legacy = chunk({ lang: 'en', bias: 0.2, doc_name: 'legacy.md' });
    const { lang: _dropped, ...withoutLang } = legacy;
    await upsertChunks([chunk({ lang: 'zh', bias: 0.9 }), withoutLang as KnowledgeChunk]);

    const results = await searchChunks(QUERY, OWNER, [KB], 1, 'openai', undefined, {
      queryLang: 'zh',
      slots: 3,
    });
    expect(results.map((r) => r.doc_name)).not.toContain('legacy.md');
  });

  test('skips the extra query entirely when no slots are asked for', async () => {
    await upsertChunks([
      chunk({ lang: 'zh', bias: 0.9 }),
      chunk({ lang: 'en', bias: 0.8, doc_name: 'en.md' }),
    ]);

    const results = await searchChunks(QUERY, OWNER, [KB], 1, 'openai', undefined, {
      queryLang: 'zh',
      slots: 0,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.doc_name).not.toBe('en.md');
  });
});

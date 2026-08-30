import { describe, expect, test } from 'bun:test';
import { detectLang } from './text-lang.js';

describe('detectLang', () => {
  test('reads technical Chinese prose as zh despite heavy English content', () => {
    // The real shape of what people upload: the Chinese design docs in this
    // repo run 6%-22% Han because they are full of code and identifiers. A
    // detector tuned for prose would call these English and make them
    // unreachable from Chinese questions.
    expect(
      detectLang('使用 `bun run dev` 启动 gateway，端口 3000，详见 docs/02-architecture.md'),
    ).toBe('zh');
  });

  test('reads English technical prose as en', () => {
    expect(detectLang('Run `docker compose up -d` to start PostgreSQL, MinIO and Qdrant.')).toBe(
      'en',
    );
  });

  test('reads Japanese as ja, not zh, despite the kanji', () => {
    // Japanese is mostly Han by character in technical writing, so a Han-ratio
    // check alone would call it Chinese. Kana is what separates them.
    expect(detectLang('ドキュメントはまだありません。アップロードで取り込めます')).toBe('ja');
    expect(detectLang('設定ファイルを編集してください')).toBe('ja');
  });

  test('reads short queries the way they were asked', () => {
    expect(detectLang('本地开发怎么开热重载')).toBe('zh');
    expect(detectLang('sessions 表存了什么')).toBe('zh');
    expect(detectLang('how to enable hot reload')).toBe('en');
  });

  test('reads a bare identifier as en, since it has no script of its own', () => {
    // Correct for retrieval: `peer_contacts` matches literally in a Chinese
    // document too, so treating it as crossing a language boundary would be
    // wrong.
    expect(detectLang('peer_contacts')).toBe('en');
    expect(detectLang('did:web')).toBe('en');
  });

  test('does not flip an English document because it quotes one Chinese phrase', () => {
    const doc = `${'The deployment guide covers prerequisites and configuration. '.repeat(20)}（部署）`;
    expect(detectLang(doc)).toBe('en');
  });

  test('handles empty and whitespace input without dividing by zero', () => {
    expect(detectLang('')).toBe('en');
    expect(detectLang('   ')).toBe('en');
  });

  test('is stateless across calls', () => {
    // The regexes are module-level with the /g flag, which carries lastIndex
    // between calls when used with exec/test — counting via match() avoids it,
    // and this is the assertion that would catch a regression to exec().
    expect(detectLang('本地开发怎么开热重载')).toBe('zh');
    expect(detectLang('本地开发怎么开热重载')).toBe('zh');
    expect(detectLang('how to enable hot reload')).toBe('en');
    expect(detectLang('how to enable hot reload')).toBe('en');
  });
});

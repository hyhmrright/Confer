import { describe, expect, test } from 'bun:test';
import { localePreload } from './vite-plugin-locale-preload.js';

// The plugin's contract is "hand the browser a modulepreload for the ONE locale
// chunk it is about to need". It used to decide which chunks were locales from a
// hardcoded `(en|zh|ja)`, so adding Arabic silently dropped it from the map: the
// injected script's `if(!u[l])l='en'` then preloaded English for an Arabic
// reader, who paid for a wasted file plus the serial round trip this plugin
// exists to remove. Nothing failed — the plugin only warns when *no* locale
// matches, never on a partial miss, and the map lives in built output that no
// test looked at.

type Chunk = { type: 'chunk'; facadeModuleId: string | null };

function runHandler(bundle: Record<string, Chunk>) {
  const plugin = localePreload();
  const transform = plugin.transformIndexHtml;
  if (typeof transform !== 'object' || typeof transform.handler !== 'function') {
    throw new Error('transformIndexHtml is not an object hook');
  }
  const warnings: string[] = [];
  const emitted: { fileName?: string; source?: unknown }[] = [];
  const ctx = {
    warn: (m: string) => warnings.push(m),
    emitFile: (f: { fileName?: string; source?: unknown }) => emitted.push(f),
  };
  // `configResolved` is what supplies `base`; skipping it leaves the default '/'.
  const result = transform.handler.call(ctx as never, '<html><head></head><body></body></html>', {
    bundle,
  } as never);
  const injected =
    typeof result === 'object' && result !== null && 'tags' in result
      ? String(result.tags?.[0]?.children ?? '')
      : '';
  return { injected, warnings, emitted };
}

const localeChunk = (lng: string): Chunk => ({
  type: 'chunk',
  facadeModuleId: `/repo/packages/client/src/i18n/locales/${lng}.ts`,
});

describe('localePreload', () => {
  test('maps every locale chunk in the bundle, not a fixed list', () => {
    const { injected } = runHandler({
      'assets/en-aaa.js': localeChunk('en'),
      'assets/zh-bbb.js': localeChunk('zh'),
      'assets/ja-ccc.js': localeChunk('ja'),
      'assets/ar-ddd.js': localeChunk('ar'),
    });

    expect(injected).toContain('"en":"/assets/en-aaa.js"');
    expect(injected).toContain('"zh":"/assets/zh-bbb.js"');
    expect(injected).toContain('"ja":"/assets/ja-ccc.js"');
    expect(injected).toContain('"ar":"/assets/ar-ddd.js"');
  });

  // The regression in one assertion: a language the plugin has never heard of
  // has to appear anyway, because the only list that should decide this is the
  // set of files in src/i18n/locales.
  test('picks up a language nobody taught it about', () => {
    const { injected, warnings } = runHandler({ 'assets/bn-eee.js': localeChunk('bn') });
    expect(injected).toContain('"bn":"/assets/bn-eee.js"');
    expect(warnings).toEqual([]);
  });

  test('ignores chunks that are not locales', () => {
    const { injected } = runHandler({
      'assets/ar-ddd.js': localeChunk('ar'),
      'assets/index-fff.js': {
        type: 'chunk',
        facadeModuleId: '/repo/packages/client/src/main.tsx',
      },
      'assets/vendor-ggg.js': { type: 'chunk', facadeModuleId: null },
    });
    expect(injected).toContain('"ar":"/assets/ar-ddd.js"');
    expect(injected).not.toContain('main');
    expect(injected).not.toContain('vendor');
  });

  test('warns instead of injecting when the bundle has no locales at all', () => {
    const { injected, warnings } = runHandler({
      'assets/index-fff.js': {
        type: 'chunk',
        facadeModuleId: '/repo/packages/client/src/main.tsx',
      },
    });
    expect(injected).toBe('');
    expect(warnings).toHaveLength(1);
  });

  // The CSP hash is computed from the finished script, and the locale map is
  // interpolated into that script — so adding a language changes the hash. The
  // Dockerfile pastes whatever is emitted here into nginx's header, so the two
  // can only disagree if the hash stops covering the script actually injected.
  test('emits a CSP hash covering the script it injects', async () => {
    const { injected, emitted } = runHandler({ 'assets/ar-ddd.js': localeChunk('ar') });
    const hashes = emitted.find((f) => f.fileName === 'csp-script-hashes.txt');
    expect(hashes).toBeDefined();

    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(injected)),
    );
    const expected = `'sha256-${btoa(String.fromCharCode(...digest))}'`;
    expect(String(hashes?.source)).toContain(expected);
  });
});

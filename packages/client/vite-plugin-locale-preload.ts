import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

// Splitting the locales is only a win if the chosen one is fetched *alongside*
// the main bundle. Left to itself the browser cannot know which language it
// needs until the main chunk has downloaded, parsed and run — the dynamic
// import in i18n/index.ts is a serial extra round trip at that point, which on
// a slow link costs more than the 7.8 KB the split saves.
//
// So resolve the language during HTML parse instead, from the same two sources
// i18next's detector uses, and hand the browser a modulepreload for exactly one
// chunk. The later import() then resolves out of the module map. Getting the
// guess wrong costs one wasted small file, never correctness: i18next still
// decides the real language, and loadResources fetches whatever it picked.
//
// The bodies of every inline `<script>` in the page — those with a `src` load an
// external file and are covered by `script-src 'self'` instead.
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1] ?? '',
  );
}

function sha256Base64(text: string): string {
  return createHash('sha256').update(text).digest('base64');
}

// Build-only. The dev server has no hashed names and no latency worth shaving.
export function localePreload(): Plugin {
  let base = '/';
  return {
    name: 'confer-locale-preload',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const urls: Record<string, string> = {};
        for (const [fileName, chunk] of Object.entries(ctx.bundle ?? {})) {
          if (chunk.type !== 'chunk') continue;
          const match = /\/src\/i18n\/locales\/(en|zh|ja)\.ts$/.exec(chunk.facadeModuleId ?? '');
          if (match) urls[match[1]] = `${base}${fileName}`;
        }
        if (Object.keys(urls).length === 0) {
          this.warn('no locale chunks found — the preload hint was not injected');
          return html;
        }

        const script =
          `(function(u){var l=null;try{l=localStorage.getItem('confer_lang')}catch(e){}` +
          `l=(l||navigator.language||'en').slice(0,2);if(!u[l])l='en';` +
          `var k=document.createElement('link');k.rel='modulepreload';k.href=u[l];` +
          `document.head.appendChild(k)})(${JSON.stringify(urls)})`;

        // The page's CSP names its inline scripts by hash, so `script-src` needs
        // no 'unsafe-inline'. The hashes are emitted here rather than recomputed
        // downstream because this is where the script above is written: editing
        // it moves its hash with no second place to remember.
        // `infra/client.Dockerfile` substitutes these into the nginx header
        // config and fails the build if the file is missing.
        //
        // Hashing whatever else the build already put in the page, rather than
        // asserting ours is the only one, is what keeps this from rotting
        // quietly. Vite injects an inline modulepreload polyfill under build
        // settings this project does not currently use, and a future plugin may
        // inject anything; an unhashed script is refused at runtime with no
        // build-time signal, which for a polyfill would mean a silent
        // performance regression nobody goes looking for. This hook runs `post`
        // and last, so `html` already holds everything injected before it.
        // Emitted as finished CSP tokens rather than bare digests, so how a hash
        // is spelled in a policy stays knowledge of this file and the Dockerfile
        // only has to paste.
        this.emitFile({
          type: 'asset',
          fileName: 'csp-script-hashes.txt',
          source: [...inlineScripts(html), script]
            .map((s) => `'sha256-${sha256Base64(s)}'`)
            .join(' '),
        });

        return {
          html,
          tags: [{ tag: 'script', injectTo: 'head-prepend', children: script }],
        };
      },
    },
  };
}

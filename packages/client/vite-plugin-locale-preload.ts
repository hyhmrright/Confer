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

        return {
          html,
          tags: [
            {
              tag: 'script',
              injectTo: 'head-prepend',
              children:
                `(function(u){var l=null;try{l=localStorage.getItem('confer_lang')}catch(e){}` +
                `l=(l||navigator.language||'en').slice(0,2);if(!u[l])l='en';` +
                `var k=document.createElement('link');k.rel='modulepreload';k.href=u[l];` +
                `document.head.appendChild(k)})(${JSON.stringify(urls)})`,
            },
          ],
        };
      },
    },
  };
}

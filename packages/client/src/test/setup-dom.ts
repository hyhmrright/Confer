// Registers a DOM on the global object so React components can actually mount.
// Preloaded for every client test via bunfig.toml — the store/lib tests never
// touch the DOM and are unaffected.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

// React 19 checks this flag to decide whether act() warnings apply.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// i18next no longer initialises on import — main.tsx awaits initI18n() so the
// first render already has its strings. Tests get the same treatment here, once
// for the whole run, rather than each rendering test remembering to do it.
const { initI18n } = await import('../i18n/index.js');
await initI18n();

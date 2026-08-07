// Registers a DOM on the global object so React components can actually mount.
// Preloaded for every client test via bunfig.toml — the store/lib tests never
// touch the DOM and are unaffected.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

// React 19 checks this flag to decide whether act() warnings apply.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Component, type ReactNode } from 'react';
import i18n from '../i18n/index.js';
import { FOCUS_RING } from '../lib/styles.js';

// Splitting the bundle into lazily-fetched route chunks created a failure mode
// that did not exist when there was a single script: a chunk request can fail
// on its own — a dropped connection, or a file a later deploy has replaced —
// and a rejected `lazy()` import throws past Suspense with nothing to catch it,
// so the page simply goes blank. This turns that into something a user can act
// on, and reloading genuinely fixes it: the shell is served `no-cache`, so a
// fresh load names whatever chunks currently exist.
//
// A class because error boundaries still have no hook equivalent in React 19;
// `i18n.t` directly because a class cannot use useTranslation, and this renders
// once and is then replaced by a reload.
export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-dark-base px-6">
        <p className="text-sm text-ink-secondary text-center">{i18n.t('common.loadFailed')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-500 transition-colors ${FOCUS_RING}`}
        >
          {i18n.t('common.retry')}
        </button>
      </div>
    );
  }
}

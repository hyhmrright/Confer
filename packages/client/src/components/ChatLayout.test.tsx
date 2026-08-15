import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// The drawer's most important property — that a closed drawer is out of the tab
// order — comes from `display: none`, and CSS does not apply in these tests. It
// is verified in a real browser instead. What is covered here is the JavaScript
// half: that `inert` lands on the main content only while the drawer actually
// covers it, and that the drawer gets out of the way once it has been used.

// Longest prefix first: `/errands` would otherwise swallow the cards endpoint
// and land `undefined` in the store, which ErrandInbox reads without a guard.
const get = mock(async (path: string) => {
  if (path.startsWith('/errands/cards/pending')) return { cards: [] };
  if (path.startsWith('/errands')) return { errands: [] };
  if (path.startsWith('/conversations')) return { conversations: [], messages: [] };
  if (path.startsWith('/permissions')) return { permissions: [] };
  if (path.startsWith('/contacts')) return { contacts: [] };
  return {};
});

mock.module('../lib/api.js', () => ({
  api: {
    get,
    post: mock(async () => ({})),
    put: mock(async () => ({})),
    patch: mock(async () => ({})),
    del: mock(async () => ({})),
  },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => 'test-token'),
}));

// ChatLayout opens a socket on mount; stub every entry point it reaches for.
mock.module('../lib/ws.js', () => ({
  connectWs: mock(() => {}),
  disconnectWs: mock(() => {}),
  reconnectWs: mock(() => {}),
  onWsMessage: mock(() => () => {}),
  subscribeConversation: mock(() => {}),
  unsubscribeConversation: mock(() => {}),
}));

// useIsNarrow reads matchMedia, which happy-dom answers from a viewport this
// test has no other way to set.
let narrow = false;
const listeners = new Set<() => void>();
window.matchMedia = ((query: string) =>
  ({
    media: query,
    get matches() {
      return narrow;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

const setNarrow = (value: boolean) => {
  narrow = value;
  for (const fn of listeners) fn();
};

const { ChatLayout } = await import('./ChatLayout.js');
const i18n = (await import('../i18n/index.js')).default;

await i18n.changeLanguage('en');

const draw = () =>
  render(
    <MemoryRouter>
      <ChatLayout />
    </MemoryRouter>,
  );
const hamburger = () => screen.queryByRole('button', { name: 'Open navigation' });
// Both the top bar and the content go inert together, so the drawer is the only
// region left interactive. 0 means the drawer is not acting as an overlay.
const inertCount = () => document.querySelectorAll('[inert]').length;
const OVERLAID = 2;

beforeEach(() => {
  narrow = false;
  listeners.clear();
});
afterEach(cleanup);

describe('ChatLayout responsive shell', () => {
  // Whether the hamburger and the drawer are *visible* is decided by `md:`
  // classes, and CSS does not apply here — both are in the DOM at every width.
  // These tests cover the part that is JavaScript: when the drawer behaves as an
  // overlay. The visibility half is verified in a real browser.
  test('the hamburger is wired to the drawer it controls', async () => {
    setNarrow(true);
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());

    expect(hamburger()?.getAttribute('aria-controls')).toBe('app-drawer');
    expect(hamburger()?.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('app-drawer')).not.toBeNull();
  });

  test('on a wide viewport the drawer never becomes an overlay', async () => {
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());

    fireEvent.click(hamburger() as HTMLElement);

    // No backdrop, and nothing inert: at this width the rail and sidebar are
    // ordinary layout, so there is nothing for them to cover.
    expect(inertCount()).toBe(0);
    expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
  });

  test('opening the drawer makes the content behind it inert', async () => {
    setNarrow(true);
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(inertCount()).toBe(0);

    fireEvent.click(hamburger() as HTMLElement);

    expect(hamburger()?.getAttribute('aria-expanded')).toBe('true');
    expect(inertCount()).toBe(OVERLAID);
  });

  test('Escape closes the drawer and releases the content', async () => {
    setNarrow(true);
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(hamburger() as HTMLElement);
    expect(inertCount()).toBe(OVERLAID);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(inertCount()).toBe(0);
    expect(hamburger()?.getAttribute('aria-expanded')).toBe('false');
  });

  test('the backdrop closes the drawer', async () => {
    setNarrow(true);
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(hamburger() as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));

    expect(inertCount()).toBe(0);
  });

  // Widening the viewport turns the drawer back into ordinary layout. If the
  // open flag survived that, the main content would stay inert on a desktop —
  // every control on the page dead with nothing on screen to explain why.
  test('growing past the breakpoint releases a drawer left open', async () => {
    setNarrow(true);
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(hamburger() as HTMLElement);
    expect(inertCount()).toBe(OVERLAID);

    setNarrow(false);

    await waitFor(() => expect(inertCount()).toBe(0));
    expect(hamburger()?.getAttribute('aria-expanded')).toBe('false');
  });

  test('choosing a section from the rail dismisses the drawer', async () => {
    setNarrow(true);
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(hamburger() as HTMLElement);

    fireEvent.click(screen.getByTitle('Contacts'));

    expect(inertCount()).toBe(0);
  });
});

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// The screens behind the login wall. They could not be smoke-tested in a browser
// (that needs a real password), so this file is the standing proof that they
// still mount, fetch and paint under the current React / react-router / markdown
// stack. Each store's fetch is answered with a minimal valid payload.
const get = mock(async (path: string) => {
  if (path.startsWith('/admin/stats')) {
    return { stats: { users: 3, agents: 3, conversations: 7, messages: 42 } };
  }
  if (path.startsWith('/admin/config')) return { config: {} };
  if (path.startsWith('/admin/users')) {
    return {
      users: [
        {
          id: 'u1',
          username: 'target',
          role: 'member',
          status: 'active',
          created_at: '2026-08-07T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
    };
  }
  if (path.startsWith('/knowledge-bases')) return { knowledge_bases: [], documents: [] };
  if (path.startsWith('/memories')) return { memories: [] };
  if (path.startsWith('/conversations')) return { conversations: [], messages: [] };
  if (path.startsWith('/permissions')) return { permissions: [] };
  if (path.startsWith('/contacts')) return { contacts: [] };
  if (path.startsWith('/errands')) return { errands: [] };
  if (path === '/users/me') return { user: { username: 'tester', preferences: {} } };
  if (path === '/agents/me') return { agent: { model_config: {}, policies_json: {} } };
  return {};
});

// Admin moderation writes go through PATCH. This one always fails, which is the
// case the UI used to swallow: the store deliberately doesn't catch, so without
// a handler in the row the rejection escapes an un-awaited onClick.
const patch = mock(async () => {
  throw new Error('server said no');
});

mock.module('../lib/api.js', () => ({
  api: {
    get,
    patch,
    post: mock(async () => ({})),
    put: mock(async () => ({})),
    del: mock(async () => ({})),
  },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  getToken: mock(() => 'test-token'),
}));

// ChatLayout opens a live socket on mount; stub the module so nothing dials out.
mock.module('../lib/ws.js', () => ({
  connectWebSocket: mock(() => ({ close: mock(() => {}) })),
  closeWebSocket: mock(() => {}),
  sendWebSocket: mock(() => {}),
}));

const i18n = (await import('../i18n/index.js')).default;
const { AdminPage } = await import('./AdminPage.js');
const { KnowledgePage } = await import('./KnowledgePage.js');
const { MemoryPage } = await import('./MemoryPage.js');
const { PermissionInbox } = await import('./PermissionInbox.js');
const { usePermissionsStore } = await import('../stores/permissions.js');

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(cleanup);

describe('authenticated screens mount', () => {
  test('AdminPage renders and pulls its stats', async () => {
    wrap(<AdminPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  // A moderation action that the server rejects must say so. It used to fail
  // silently: the row re-enabled, the user list was unchanged, and the only
  // trace was an unhandled rejection in the console — an admin could believe
  // they had disabled an account that was still active.
  test('a rejected moderation action reports the failure and re-enables the row', async () => {
    const confirmed = window.confirm;
    window.confirm = () => true;
    try {
      wrap(<AdminPage />);
      // Rail order is back, overview, users, content, config.
      fireEvent.click(screen.getAllByRole('button')[2] as HTMLElement);

      const rowButtons = () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>('tbody tr td:last-child button'));
      await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0));

      fireEvent.click(rowButtons()[0] as HTMLButtonElement);

      await waitFor(() => expect(patch).toHaveBeenCalled());
      await waitFor(() =>
        expect(document.querySelector('tbody tr')?.textContent).toContain(
          i18n.t('admin.actionError'),
        ),
      );
      // Re-enabled, so the admin can retry rather than being stuck on a dead row.
      expect(rowButtons().every((b) => !b.disabled)).toBe(true);
    } finally {
      window.confirm = confirmed;
    }
  });

  test('KnowledgePage renders its empty state without throwing', async () => {
    wrap(<KnowledgePage />);
    await waitFor(() => expect(document.querySelectorAll('button').length).toBeGreaterThan(0));
  });

  test('MemoryPage renders its empty state without throwing', async () => {
    wrap(<MemoryPage />);
    await waitFor(() => expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0));
  });

  test('PermissionInbox renders nothing when there is nothing pending', () => {
    usePermissionsStore.setState({ pending: [] });
    wrap(<PermissionInbox />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  // The consent gate: pending requests must actually reach the screen. If this
  // stack silently renders nothing, inbound A2A connect requests are unapprovable.
  test('PermissionInbox renders one decidable card per pending request', () => {
    usePermissionsStore.setState({
      pending: [
        {
          id: 'p1',
          level: 'L2',
          action: 'connect',
          scope: {},
          peer_name: 'Stranger',
          peer_did: 'did:web:stranger.example',
          requested_at: '2026-08-07T10:00:00Z',
        },
        {
          id: 'p2',
          level: 'L3',
          action: 'send_message',
          scope: {},
          peer_name: 'Courier',
          peer_did: 'did:web:courier.example',
          requested_at: '2026-08-07T10:01:00Z',
        },
      ] as never,
    });
    wrap(<PermissionInbox />);
    expect(screen.getByText(/Stranger/)).toBeDefined();
    expect(screen.getByText(/Courier/)).toBeDefined();
    // three controls per card, and never an auto-accept
    expect(screen.getAllByRole('button')).toHaveLength(6);
    usePermissionsStore.setState({ pending: [] });
  });
});

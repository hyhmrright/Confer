import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  if (path.startsWith('/admin/users')) return { users: [] };
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

mock.module('../lib/api.js', () => ({
  api: {
    get,
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

await import('../i18n/index.js');
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

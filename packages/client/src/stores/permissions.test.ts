import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the HTTP layer so store logic is tested without a real backend.
const get = mock(async (_path: string) => ({ permissions: [] }) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  getToken: mock(() => null),
}));

const { usePermissionsStore } = await import('./permissions.js');

const initial = usePermissionsStore.getState();

const req = (id: string) => ({
  id,
  level: 'L2',
  action: 'send_message',
  scope: {},
  description: `request ${id}`,
  requested_at: '2026-05-31T00:00:00Z',
});

beforeEach(() => {
  get.mockReset();
  usePermissionsStore.setState({ pending: [], history: [], historyError: null });
});

afterEach(() => {
  usePermissionsStore.setState(initial, true);
});

describe('permissions store', () => {
  test('loadPending fetches and stores the pending requests', async () => {
    const permissions = [req('r1'), req('r2')];
    get.mockResolvedValueOnce({ permissions });
    await usePermissionsStore.getState().loadPending();
    expect(get).toHaveBeenCalledWith('/permissions/pending');
    expect(usePermissionsStore.getState().pending).toEqual(permissions as never);
  });

  test('loadPending swallows errors and leaves state unchanged', async () => {
    usePermissionsStore.setState({ pending: [req('existing')] as never });
    get.mockRejectedValueOnce(new Error('endpoint missing'));
    await usePermissionsStore.getState().loadPending();
    expect(usePermissionsStore.getState().pending.map((p) => p.id)).toEqual(['existing']);
  });

  test('loadHistory fetches and stores decided permission rows', async () => {
    const permissions = [
      {
        id: 'h1',
        action: 'send_message',
        level: 'L2',
        decision: 'allow',
        peer_id: 'p1',
        decided_at: '2026-05-31T00:00:00Z',
      },
      {
        id: 'h2',
        action: 'read_memory',
        level: 'L1',
        decision: 'deny',
        peer_id: null,
        decided_at: '2026-05-30T00:00:00Z',
      },
    ];
    get.mockResolvedValueOnce({ permissions });
    await usePermissionsStore.getState().loadHistory();
    expect(get).toHaveBeenCalledWith('/permissions/history');
    expect(usePermissionsStore.getState().history).toEqual(permissions as never);
  });

  test('loadHistory surfaces errors without clobbering existing history', async () => {
    usePermissionsStore.setState({ history: [{ id: 'existing' }] as never });
    get.mockRejectedValueOnce(new Error('boom'));
    await usePermissionsStore.getState().loadHistory();
    // History is left intact, and the failure is surfaced (not silently empty).
    expect(usePermissionsStore.getState().history.map((h) => h.id)).toEqual(['existing']);
    expect(usePermissionsStore.getState().historyError).toBeTruthy();
  });

  test('addRequest prepends the new request', () => {
    usePermissionsStore.setState({ pending: [req('r1')] as never });
    usePermissionsStore.getState().addRequest(req('r2') as never);
    expect(usePermissionsStore.getState().pending.map((p) => p.id)).toEqual(['r2', 'r1']);
  });

  test('removeRequest drops the matching request from state', () => {
    usePermissionsStore.setState({ pending: [req('r1'), req('r2')] as never });
    usePermissionsStore.getState().removeRequest('r1');
    expect(usePermissionsStore.getState().pending.map((p) => p.id)).toEqual(['r2']);
  });
});

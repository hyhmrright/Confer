import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const keys = [
  {
    key_id: 'did:web:x:agents:me#key-2',
    created_at: '2026-10-01T00:00:00Z',
    status: 'current',
    retires_at: null,
  },
  {
    key_id: 'did:web:x:agents:me#key-1',
    created_at: '2026-09-01T00:00:00Z',
    status: 'retiring',
    retires_at: '2026-10-31T00:00:00Z',
  },
];
const get = mock(async (path: string) =>
  path === '/users/me/keys' ? { keys } : { documents: [], total: 0 },
);
const post = mock(async (_path: string, _body?: unknown) => ({}) as unknown);
mock.module('../../lib/api.js', () => ({
  api: {
    get,
    post,
    put: mock(async () => ({})),
    patch: mock(async () => ({})),
    delete: mock(async () => ({})),
  },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  refreshSession: mock(async () => false),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

const { changeLanguage } = await import('../../i18n/index.js');
const { SigningKeys } = await import('./SigningKeys.js');

afterEach(cleanup);

describe('SigningKeys', () => {
  test('rotates only on a second click, and revokes a retiring key', async () => {
    await changeLanguage('en');
    post.mockClear();
    render(<SigningKeys />);
    expect(await screen.findByText('#key-2')).toBeDefined();
    expect(screen.getByText('In use')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Click again to rotate' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/users/me/keys/rotate', {}));

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke now' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/users/me/keys/revoke', {
        key_id: 'did:web:x:agents:me#key-1',
      }),
    );
  });
});

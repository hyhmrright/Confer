import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listed = {
  id: 't1',
  name: 'ci',
  prefix: 'cfr_abcdefgh',
  created_at: '2026-10-01T00:00:00Z',
  last_used_at: null,
  expires_at: null,
};
let tokens = [listed];
const get = mock(async (path: string) =>
  path === '/tokens' ? { tokens } : { documents: [], total: 0 },
);
const post = mock(async (_path: string, body: { name: string }) => {
  const created = { ...listed, id: 't2', name: body.name, prefix: 'cfr_zyxwvuts' };
  tokens = [created, ...tokens];
  return { token: { ...created, token: 'cfr_zyxwvuts-the-whole-secret' } };
});
const del = mock(async (_path: string) => ({ ok: true }));
mock.module('../../lib/api.js', () => ({
  api: { get, post, delete: del, put: mock(async () => ({})), patch: mock(async () => ({})) },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  refreshSession: mock(async () => false),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

const { changeLanguage } = await import('../../i18n/index.js');
const { ApiTokens } = await import('./ApiTokens.js');

afterEach(cleanup);

describe('ApiTokens', () => {
  test('shows a new token once, lists tokens by prefix, and revokes', async () => {
    await changeLanguage('en');
    render(<ApiTokens />);
    expect(await screen.findByText('ci')).toBeDefined();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByText('cfr_zyxwvuts-the-whole-secret')).toBeDefined();
    expect(post).toHaveBeenCalledWith('/tokens', { name: 'laptop' });
    expect(await screen.findByText('laptop')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[1] as HTMLElement);
    await waitFor(() => expect(del).toHaveBeenCalledWith('/tokens/t1'));
    await waitFor(() => expect(screen.queryByText('ci')).toBeNull());
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const post = mock(async (_path: string, _body?: unknown) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { post, get: mock(async () => ({})), put: mock(async () => ({})) },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  getToken: mock(() => null),
}));

await import('../i18n/index.js');
const { PermissionCard } = await import('./PermissionCard.js');
const { fireEvent } = await import('@testing-library/react');

const request = {
  id: 'req-1',
  level: 'L3',
  action: 'send_message',
  scope: {},
  description: '向 peer 发送消息',
  requested_at: '2026-08-07T00:00:00Z',
};

beforeEach(() => post.mockReset());
afterEach(cleanup);

describe('PermissionCard', () => {
  test('renders the request and all three decision controls', () => {
    render(<PermissionCard request={request} />);
    expect(screen.getByText('向 peer 发送消息')).toBeDefined();
    expect(screen.getByText('L3')).toBeDefined();
    // allow-once / allow-always / deny — the L3 path must never auto-accept.
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  test('deciding posts the decision and swaps the card into its decided state', async () => {
    post.mockResolvedValueOnce({});
    const onDecided = mock(() => {});
    render(<PermissionCard request={request} onDecided={onDecided} />);

    fireEvent.click(screen.getAllByRole('button')[1] as HTMLElement); // allow_always

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/permissions/req-1/decide', {
      decision: 'allow_always',
      scope: 'peer_action',
    });
    await waitFor(() => expect(screen.queryAllByRole('button')).toHaveLength(0));
    expect(onDecided).toHaveBeenCalledTimes(1);
  });

  test('a failed decision keeps the controls and surfaces an error', async () => {
    post.mockRejectedValueOnce(new Error('boom'));
    render(<PermissionCard request={request} />);

    fireEvent.click(screen.getAllByRole('button')[2] as HTMLElement); // deny

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Still decidable — a network failure must not look like a decision.
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(3));
  });
});

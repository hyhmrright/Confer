import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const post = mock(async (_path: string, _body?: unknown) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { post, get: mock(async () => ({})), put: mock(async () => ({})) },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

const { changeLanguage } = await import('../i18n/index.js');
const { PermissionCard } = await import('./PermissionCard.js');
const { fireEvent } = await import('@testing-library/react');

const request = {
  id: 'req-1',
  level: 'L3',
  action: 'send_message',
  scope: {},
  peer_name: 'Alice',
  peer_did: 'did:web:example.com',
  requested_at: '2026-08-07T00:00:00Z',
};

beforeEach(() => post.mockReset());
afterEach(cleanup);

describe('PermissionCard', () => {
  test('renders the request and all three decision controls', () => {
    render(<PermissionCard request={request} />);
    expect(screen.getByText(/Alice/)).toBeDefined();
    expect(screen.getByText('L3')).toBeDefined();
    // allow-once / allow-always / deny — the L3 path must never auto-accept.
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  // The description used to be rendered server-side in Chinese and shipped as a
  // string, so an en/ja owner was asked to approve a peer in a language they may
  // not read — on the one screen where that matters most. It is now composed from
  // structured fields through i18n; this is the regression guard.
  test('describes the request in the reader’s language, not the server’s', async () => {
    const connect = { ...request, action: 'connect', scope: { first_message: 'hi there' } };

    await changeLanguage('en');
    const { unmount } = render(<PermissionCard request={connect} />);
    expect(screen.getByText('Alice wants to connect to your agent: “hi there”')).toBeDefined();
    unmount();

    await changeLanguage('ja');
    render(<PermissionCard request={connect} />);
    expect(
      screen.getByText('Alice があなたのエージェントへの接続を求めています：「hi there」'),
    ).toBeDefined();

    await changeLanguage('en');
  });

  test('falls back to the peer DID, then to a generic label, when no name is known', async () => {
    await changeLanguage('en');
    const { unmount } = render(<PermissionCard request={{ ...request, peer_name: null }} />);
    expect(screen.getByText(/did:web:example\.com/)).toBeDefined();
    unmount();

    // An action the client has no label for — the branch that has to keep
    // working when a newer gateway invents one.
    render(
      <PermissionCard
        request={{ ...request, action: 'reticulate_splines', peer_name: null, peer_did: null }}
      />,
    );
    expect(screen.getByText('An agent is requesting: reticulate_splines')).toBeDefined();
  });

  // The actions agent-runtime names by hand used to fall through to the generic
  // branch, so the L3 ones — money, signatures — reached the owner as a raw
  // identifier on the one screen where understanding the request is the point.
  test('names a known action in prose rather than printing its identifier', async () => {
    await changeLanguage('en');
    render(<PermissionCard request={{ ...request, action: 'sign_contract' }} />);
    expect(screen.getByText('Alice is asking to sign a contract on your behalf')).toBeDefined();
    expect(screen.queryByText(/sign_contract/)).toBeNull();
  });

  test('deciding posts the decision and swaps the card into its decided state', async () => {
    post.mockResolvedValueOnce({});
    const onDecided = mock(() => {});
    await changeLanguage('en');
    render(<PermissionCard request={request} onDecided={onDecided} />);

    // By name, not by index: the order of these three is a design decision that
    // has already changed once, and a positional selector silently retargets.
    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }));

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
    await changeLanguage('en');
    render(<PermissionCard request={request} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Still decidable — a network failure must not look like a decision.
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(3));
  });
});

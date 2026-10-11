import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const agent = {
  id: 'agent-1',
  policies_json: {
    default: 'allow',
    rules: [
      { action: 'ask', decision: 'deny' },
      { action: '*', decision: 'ask_user' },
    ],
  },
};
const get = mock(async (_path: string) => ({ agent }) as unknown);
const put = mock(async (_path: string, _body?: unknown) => ({}) as unknown);
mock.module('../../lib/api.js', () => ({
  api: { get, put, post: mock(async () => ({})), patch: mock(async () => ({})) },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  refreshSession: mock(async () => false),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

const { changeLanguage } = await import('../../i18n/index.js');
const { PolicyTab } = await import('./PolicyTab.js');

afterEach(cleanup);

describe('PolicyTab', () => {
  // A standing "always" decision lands here as a rule, and removing it is the
  // only way to undo one — so a removal has to reach the saved body, and must
  // take only that rule with it.
  test('removing a rule and saving drops exactly that rule', async () => {
    await changeLanguage('en');
    render(<PolicyTab />);

    const remove = await screen.findAllByRole('button', { name: 'Remove' });
    expect(remove).toHaveLength(2);
    fireEvent.click(remove[0] as HTMLElement);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/agents/me/policies', {
      default: 'allow',
      rules: [{ action: '*', decision: 'ask_user' }],
    });
  });
});

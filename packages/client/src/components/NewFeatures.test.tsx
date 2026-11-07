import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const post = mock(async (_path: string, _body?: unknown) => ({}) as unknown);
const get = mock(async (_path: string) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: {
    post,
    get,
    put: mock(async () => ({})),
    patch: mock(async () => ({})),
    delete: mock(async () => ({})),
  },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  refreshSession: mock(async () => false),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => 'test-token'),
}));
const { changeLanguage } = await import('../i18n/index.js');
const { DemoPage } = await import('./DemoPage.js');
const { AnswerFeedback } = await import('./AnswerFeedback.js');
const { DeviceConnectPage } = await import('./DeviceConnectPage.js');
const { useAuthStore } = await import('../stores/auth.js');
beforeEach(async () => {
  post.mockReset();
  get.mockReset();
  await changeLanguage('en');
});
afterEach(cleanup);
const draw = (children: React.ReactNode, route = '/') =>
  render(<MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>);

describe('public demo agent', () => {
  test('needs contact and scoped access, cites its manual, requires explicit purchase approval and honors revocation', async () => {
    draw(<DemoPage />);
    const question = screen.getByRole('button', {
      name: 'How do I connect the X100?',
    }) as HTMLButtonElement;
    expect(question.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add demo contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
    expect(question.disabled).toBe(false);
    fireEvent.click(question);
    expect(screen.getByRole('link', { name: /X100 demo manual/ }).getAttribute('href')).toBe(
      '/examples/x100-manual.md',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show the owner’s customer list' }));
    expect(screen.getByText(/outside the authorized manual/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Buy one X100' }));
    expect(screen.queryByText('Demo approval recorded. No order was placed.')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Authorize' })[1] as HTMLElement);
    expect(screen.getByText('Demo approval recorded. No order was placed.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(question.disabled).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });
});
test('answer feedback stores the correction without pretending it retrains the model', async () => {
  post.mockResolvedValue({});
  draw(<AnswerFeedback messageId="01J00000000000000000000001" />);
  fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'The manual says 24V, not 12V.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('does not retrain'));
  expect(post).toHaveBeenCalledWith('/feedback', {
    message_id: '01J00000000000000000000001',
    kind: 'incorrect_answer',
    note: 'The manual says 24V, not 12V.',
  });
});
test('device approval shows the verified device and scope before any consent request', async () => {
  useAuthStore.setState({
    accessToken: 'test',
    user: { id: 'u', username: 'alice', did: 'did:web:example.com', display_name: undefined },
  });
  post.mockImplementation(async (path) =>
    path === '/device-auth/request'
      ? { name: 'My editor', expires_at: new Date(Date.now() + 600000).toISOString() }
      : {},
  );
  draw(<DeviceConnectPage />, '/connect?code=AABBCCDD');
  expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
  await waitFor(() => expect(screen.getByText('My editor')).toBeDefined());
  expect(screen.getByText(/90-day personal API/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Request processed'),
  );
  expect(post).toHaveBeenCalledWith('/device-auth/decide', {
    user_code: 'AABBCCDD',
    approve: true,
  });
});

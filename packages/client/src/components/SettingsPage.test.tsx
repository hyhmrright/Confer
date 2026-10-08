import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Every settings tab loads through the HTTP layer on mount. Resolve each call
// with an empty-but-valid shape so the tabs render their real markup instead of
// an error state, and nothing touches the network.
// Ordered longest-prefix first: '/agents/me/llm-keys' must not be swallowed by
// the '/agents/me' arm, or llmKeys lands as undefined and KeysTab throws.
const get = mock(async (path: string) => {
  if (path === '/agents/me/llm-keys') return { keys: [] };
  if (path === '/agents/me/policies') return { policies: {} };
  if (path === '/agents/me') return { agent: { model_config: {}, policies_json: {} } };
  if (path.startsWith('/permissions')) return { permissions: [] };
  if (path === '/users/me') return { user: { username: 'tester', preferences: {} } };
  if (path.startsWith('/usage')) {
    return {
      rows: [
        {
          provider: 'deepseek',
          model: 'deepseek-chat',
          audience: 'peer',
          turns: 3,
          unreported: 1,
          failed: 0,
          input_tokens: 12345,
          output_tokens: 678,
          cache_read_tokens: null,
          cache_write_tokens: null,
        },
      ],
    };
  }
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
  refreshSession: mock(async () => false),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => 'test-token'),
}));

await import('../i18n/index.js');
const { SettingsPage } = await import('./SettingsPage.js');

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('SettingsPage', () => {
  test('renders the tab rail with all six tabs', () => {
    renderPage();
    // 1 back button + 6 tab buttons, before any tab body adds its own controls.
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels.length).toBeGreaterThanOrEqual(7);
  });

  // Switching tabs is the interaction most likely to break on a React major:
  // each click unmounts one subtree and mounts another under StrictMode.
  test('every tab mounts without throwing', async () => {
    renderPage();
    const rail = screen.getAllByRole('button').slice(1, 7);
    expect(rail).toHaveLength(6);

    for (const tab of rail) {
      const label = tab.textContent ?? '';
      fireEvent.click(tab);
      // The heading mirrors the active tab's label — proves the body swapped.
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(label),
      );
    }
  });

  test('the usage tab shows the month by model, and says what its totals leave out', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));

    const row = await screen.findByRole('rowheader', { name: /deepseek-chat/ });
    expect(row.closest('tr')?.textContent).toContain('12,345');
    expect(screen.getByText(/Turns answering your contacts: 3/)).toBeTruthy();
    expect(screen.getByText(/no usage reported by the provider: 1/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/usage\?month=\d{4}-\d{2}$/));
  });

  test('the back control is present and is a real button', () => {
    renderPage();
    const back = screen.getAllByRole('button')[0] as HTMLElement;
    expect(back.getAttribute('type')).toBe('button');
  });
});

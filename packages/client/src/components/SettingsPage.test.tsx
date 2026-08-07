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
  test('renders the tab rail with all five tabs', () => {
    renderPage();
    // 1 back button + 5 tab buttons, before any tab body adds its own controls.
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels.length).toBeGreaterThanOrEqual(6);
  });

  // Switching tabs is the interaction most likely to break on a React major:
  // each click unmounts one subtree and mounts another under StrictMode.
  test('every tab mounts without throwing', async () => {
    renderPage();
    const rail = screen.getAllByRole('button').slice(1, 6);
    expect(rail).toHaveLength(5);

    for (const tab of rail) {
      const label = tab.textContent ?? '';
      fireEvent.click(tab);
      // The heading mirrors the active tab's label — proves the body swapped.
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(label),
      );
    }
  });

  test('the back control is present and is a real button', () => {
    renderPage();
    const back = screen.getAllByRole('button')[0] as HTMLElement;
    expect(back.getAttribute('type')).toBe('button');
  });
});

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// The login screen is the only one a first-time visitor sees, so it is also the
// only place the language can still be wrong for them. Both other switchers sit
// inside the authenticated shell.
mock.module('../lib/api.js', () => ({
  api: {
    get: mock(async () => ({})),
    post: mock(async () => ({})),
    patch: mock(async () => ({})),
    put: mock(async () => ({})),
    del: mock(async () => ({})),
  },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

const { changeLanguage, SUPPORTED_LANGUAGES } = await import('../i18n/index.js');
const { LoginPage } = await import('./LoginPage.js');

afterEach(cleanup);
// i18next is process-global, so leaving this file's last switch in place would
// hand the next test file a UI in Arabic.
afterAll(() => changeLanguage('en'));

const openMenu = () => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { expanded: false }));
  return screen.getByRole('menu');
};

describe('LoginPage language switcher', () => {
  test('offers every shipping language before the visitor has an account', async () => {
    await changeLanguage('en');
    const langs = Array.from(openMenu().querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (el) => el.lang,
    );
    expect(langs).toEqual([...SUPPORTED_LANGUAGES]);
  });

  // The point of the switcher is that picking a language repaints *this* screen,
  // not that a menu opens. Asserting on the tagline is what proves it: the string
  // is unique per locale, so a switch that silently failed would leave the
  // English one on screen and fail here.
  test('switching repaints the login copy in the chosen language', async () => {
    await changeLanguage('en');
    const menu = openMenu();
    expect(screen.getByText('Your agent, speaking for you')).toBeDefined();

    const arabic = menu.querySelector<HTMLElement>('[lang="ar"]');
    fireEvent.click(arabic as HTMLElement);

    await waitFor(() => expect(screen.getByText('وكيلك، يتحدث نيابةً عنك')).toBeDefined());
    expect(document.documentElement.dir).toBe('rtl');
  });
});

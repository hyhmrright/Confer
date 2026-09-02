import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const post = mock(async () => ({}));

// The login screen is the only one a first-time visitor sees, so it is also the
// only place the language can still be wrong for them. Both other switchers sit
// inside the authenticated shell.
mock.module('../lib/api.js', () => ({
  api: {
    get: mock(async () => ({})),
    post,
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
const { gatewayOrigin, setGatewayUrl } = await import('../lib/gateway.js');
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

// A shipped desktop or mobile build serves its own assets, so `/api/v1` resolves
// to the bundle and there is no instance to sign in to until one is named. That
// is the whole reason this field exists, and the reason it is *only* here: the
// web build is same-origin and must keep asking nobody anything.
describe('LoginPage instance address', () => {
  const realLocation = globalThis.location;

  const asBundle = () =>
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { protocol: 'tauri:', hostname: 'localhost', origin: 'tauri://localhost' } as Location,
    });

  beforeEach(async () => {
    await changeLanguage('en');
    post.mockClear();
    setGatewayUrl('');
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: realLocation });
    setGatewayUrl('');
  });

  const submit = (address: string) => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    const field = screen.getByLabelText('Instance address');
    fireEvent.change(field, { target: { value: address } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'someone' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
  };

  test('is absent on the web, where every URL is already relative', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Instance address')).toBeNull();
  });

  test('a bare hostname is stored as an origin and the login goes through', async () => {
    asBundle();
    submit('confer.example.com');
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(gatewayOrigin()).toBe('https://confer.example.com');
  });

  // Storing an unusable address would turn into a bare network error on the
  // button, with nothing on screen tying it back to the field that caused it.
  test('an address that cannot carry an API stops the submit and says so', async () => {
    asBundle();
    submit('not a host');
    await waitFor(() => expect(screen.getByText(/isn't a valid address/)).toBeDefined());
    expect(post).not.toHaveBeenCalled();
    expect(gatewayOrigin()).toBe('');
  });
});

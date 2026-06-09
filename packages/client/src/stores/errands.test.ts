import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the HTTP layer so store logic is tested without a real backend. Export the
// full named set the module surface uses, so the mock can't leak a partial api
// object into other store tests sharing the process.
const get = mock(async (_path: string) => ({}) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, post },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  getToken: mock(() => null),
}));

const { useErrandsStore } = await import('./errands.js');

const initial = useErrandsStore.getState();

const card = (id: string) => ({
  id,
  errand_id: 'e1',
  errand_title: 'Rebook flight',
  kind: 'approve',
  summary: 'Confirm?',
  currency: 'USD',
  base_price_cents: null,
  price_delta_cents: null,
  strictly_necessary: true,
  expires_at: '2099-01-01T00:00:00Z',
  created_at: '2026-06-09T00:00:00Z',
});

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  useErrandsStore.setState({ errands: [], pendingCards: [], creating: false, error: null });
});

afterEach(() => {
  useErrandsStore.setState(initial, true);
});

describe('errands store', () => {
  test('loadPendingCards fetches and stores the cards', async () => {
    const cards = [card('c1'), card('c2')];
    get.mockResolvedValueOnce({ cards });
    await useErrandsStore.getState().loadPendingCards();
    expect(get).toHaveBeenCalledWith('/errands/cards/pending');
    expect(useErrandsStore.getState().pendingCards).toEqual(cards as never);
  });

  test('loadPendingCards swallows errors and leaves state unchanged', async () => {
    useErrandsStore.setState({ pendingCards: [card('existing')] as never });
    get.mockRejectedValueOnce(new Error('endpoint missing'));
    await useErrandsStore.getState().loadPendingCards();
    expect(useErrandsStore.getState().pendingCards.map((c) => c.id)).toEqual(['existing']);
  });

  test('createErrand posts the title then reloads errands', async () => {
    post.mockResolvedValueOnce({ id: 'e1', status: 'in_progress' });
    get.mockResolvedValueOnce({ errands: [] });
    await useErrandsStore.getState().createErrand('Dispute a charge', 'billing');
    expect(post).toHaveBeenCalledWith('/errands', {
      title: 'Dispute a charge',
      kind: 'billing',
    });
    expect(get).toHaveBeenCalledWith('/errands');
    expect(useErrandsStore.getState().creating).toBe(false);
  });

  test('createErrand records the error on failure', async () => {
    post.mockRejectedValueOnce(new Error('boom'));
    await useErrandsStore.getState().createErrand('x');
    expect(useErrandsStore.getState().error).toBe('boom');
    expect(useErrandsStore.getState().creating).toBe(false);
  });

  test('decideCard posts the decision and drops the card', async () => {
    useErrandsStore.setState({ pendingCards: [card('c1'), card('c2')] as never });
    post.mockResolvedValueOnce({ ok: true });
    await useErrandsStore.getState().decideCard('c1', 'approve');
    expect(post).toHaveBeenCalledWith('/errands/cards/c1/decide', {
      decision: 'approve',
      new_price_cents: undefined,
    });
    expect(useErrandsStore.getState().pendingCards.map((c) => c.id)).toEqual(['c2']);
  });

  test('decideCard sends new_price_cents only for change_price', async () => {
    post.mockResolvedValueOnce({ ok: true });
    await useErrandsStore.getState().decideCard('c1', 'change_price', 21000);
    expect(post).toHaveBeenCalledWith('/errands/cards/c1/decide', {
      decision: 'change_price',
      new_price_cents: 21000,
    });
  });

  test('removeCard drops the matching card', () => {
    useErrandsStore.setState({ pendingCards: [card('c1'), card('c2')] as never });
    useErrandsStore.getState().removeCard('c1');
    expect(useErrandsStore.getState().pendingCards.map((c) => c.id)).toEqual(['c2']);
  });
});

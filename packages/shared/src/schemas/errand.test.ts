import { describe, expect, test } from 'bun:test';
import { createErrandSchema, decideCardSchema, pushCardSchema } from './errand.js';

const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

describe('createErrandSchema', () => {
  test('accepts a minimal errand', () => {
    expect(createErrandSchema.parse({ title: 'Rebook flight' }).title).toBe('Rebook flight');
  });

  test('rejects an empty title', () => {
    expect(createErrandSchema.safeParse({ title: '' }).success).toBe(false);
  });
});

describe('pushCardSchema', () => {
  test('defaults currency to USD and strictly_necessary to true', () => {
    const card = pushCardSchema.parse({
      kind: 'approve',
      summary: 'Confirm the booking?',
      expires_at: future(),
    });
    expect(card.currency).toBe('USD');
    expect(card.strictly_necessary).toBe(true);
  });

  test('uppercases the currency', () => {
    const card = pushCardSchema.parse({
      kind: 'approve',
      summary: 's',
      currency: 'eur',
      expires_at: future(),
    });
    expect(card.currency).toBe('EUR');
  });

  test('rejects a past expiry', () => {
    const res = pushCardSchema.safeParse({
      kind: 'approve',
      summary: 's',
      expires_at: past(),
    });
    expect(res.success).toBe(false);
  });

  test('requires base_price_cents for change_price cards', () => {
    const res = pushCardSchema.safeParse({
      kind: 'change_price',
      summary: 's',
      price_delta_cents: 500,
      expires_at: future(),
    });
    expect(res.success).toBe(false);
  });

  test('accepts a negative price delta (a discount)', () => {
    const card = pushCardSchema.parse({
      kind: 'change_price',
      summary: 's',
      base_price_cents: 10000,
      price_delta_cents: -1500,
      expires_at: future(),
    });
    expect(card.price_delta_cents).toBe(-1500);
  });

  test('rejects a fractional price', () => {
    const res = pushCardSchema.safeParse({
      kind: 'change_price',
      summary: 's',
      base_price_cents: 100.5,
      expires_at: future(),
    });
    expect(res.success).toBe(false);
  });
});

describe('decideCardSchema', () => {
  test('accepts approve / reject without a price', () => {
    expect(decideCardSchema.parse({ decision: 'approve' }).decision).toBe('approve');
    expect(decideCardSchema.parse({ decision: 'reject' }).decision).toBe('reject');
  });

  test('requires new_price_cents for a change_price decision', () => {
    expect(decideCardSchema.safeParse({ decision: 'change_price' }).success).toBe(false);
    expect(
      decideCardSchema.safeParse({ decision: 'change_price', new_price_cents: 8000 }).success,
    ).toBe(true);
  });

  test('rejects an unknown decision', () => {
    expect(decideCardSchema.safeParse({ decision: 'allow_once' }).success).toBe(false);
  });
});

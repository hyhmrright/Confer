import { describe, expect, test } from 'bun:test';
import { LLM_PROVIDER_IDS } from '../llm/catalog.js';
import { modelChoiceSchema } from './agent.js';

// This schema spelled out five vendors inline and had fallen thirteen behind the
// catalogue. It could drift that far because nothing imported it, so nothing ever
// disagreed with it. These tests are that missing disagreement: the first one
// fails the moment the two stop matching, in either direction.
describe('modelChoiceSchema', () => {
  test('accepts every vendor the catalogue carries', () => {
    const rejected = LLM_PROVIDER_IDS.filter(
      (id) => !modelChoiceSchema.safeParse({ provider: id, model: 'x' }).success,
    );
    expect(rejected).toEqual([]);
  });

  test('rejects a vendor the catalogue does not carry', () => {
    expect(modelChoiceSchema.safeParse({ provider: 'not-a-vendor', model: 'x' }).success).toBe(
      false,
    );
  });
});

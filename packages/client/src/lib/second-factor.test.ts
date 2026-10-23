import { describe, expect, test } from 'bun:test';
import { secondFactorFields } from './second-factor.js';

describe('secondFactorFields', () => {
  test('six digits, however spaced, are an authenticator code', () => {
    expect(secondFactorFields('123 456')).toEqual({ totp_code: '123456' });
  });

  test('anything else is a recovery code, sent as typed', () => {
    expect(secondFactorFields(' abcde-fghij ')).toEqual({ recovery_code: 'abcde-fghij' });
    expect(secondFactorFields('12345')).toEqual({ recovery_code: '12345' });
  });
});

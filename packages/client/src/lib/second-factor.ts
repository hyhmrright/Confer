/**
 * What the person typed in the one "code" box, as the API's fields: six digits
 * is an authenticator code, anything else a recovery code. One box rather than
 * two, because at the moment of losing a phone nobody should have to find the
 * "use a recovery code instead" link.
 */
export function secondFactorFields(input: string): { totp_code?: string; recovery_code?: string } {
  const digits = input.replace(/\s/g, '');
  return /^\d{6}$/.test(digits) ? { totp_code: digits } : { recovery_code: input.trim() };
}

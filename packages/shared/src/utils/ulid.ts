import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isValidId(id: string): boolean {
  return ULID_REGEX.test(id);
}

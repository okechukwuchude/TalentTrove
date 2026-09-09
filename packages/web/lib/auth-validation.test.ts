import { describe, expect, it } from 'vitest';
import { isValidEmail, passwordError } from './auth-validation.ts';

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('a@example.com')).toBe(true);
  });

  it('rejects a string with no @', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
});

describe('passwordError', () => {
  it('accepts an 8-character password', () => {
    expect(passwordError('12345678')).toBeNull();
  });

  it('rejects a 7-character password with a message naming the minimum', () => {
    expect(passwordError('1234567')).toBe('that password must be at least 8 characters');
  });
});

import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './tokens.ts';

describe('generateToken', () => {
  it('generates a different token every call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('generates a URL-safe string with no padding characters', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashToken', () => {
  it('hashes the same token to the same value', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('hashes different tokens to different values', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });

  it('returns a 64-character hex string', () => {
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

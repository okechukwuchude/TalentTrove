import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './settings-crypto.ts';

describe('settings-crypto', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it('round-trips a plaintext value', () => {
    const stored = encryptSecret('super-secret-key');
    expect(decryptSecret(stored)).toBe('super-secret-key');
  });

  it('produces different ciphertext for the same plaintext on repeated calls', () => {
    const first = encryptSecret('same-value');
    const second = encryptSecret('same-value');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe('same-value');
    expect(decryptSecret(second)).toBe('same-value');
  });

  it('throws when decrypting a tampered ciphertext', () => {
    const stored = encryptSecret('super-secret-key');
    const [iv, authTag] = stored.split(':');
    expect(() => decryptSecret(`${iv}:${authTag}:AAAAAAAAAAAAAAAA`)).toThrow();
  });

  it('throws when SESSION_SECRET is not set', () => {
    delete process.env.SESSION_SECRET;
    expect(() => encryptSecret('x')).toThrow(/SESSION_SECRET/);
  });
});

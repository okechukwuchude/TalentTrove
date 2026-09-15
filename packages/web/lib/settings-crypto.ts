import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Purpose-specific, not secret — it only needs to keep this derived key from
// colliding with some other scryptSync(SESSION_SECRET, ...) use elsewhere in
// this app. SESSION_SECRET itself, unique per deployment and already
// required to be high-entropy, is the actual secret input.
const SALT = 'pinloop-settings-v1';

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET must be set to encrypt/decrypt settings');
  return scryptSync(secret, SALT, 32);
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const key = deriveKey();
  const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error('malformed encrypted setting');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

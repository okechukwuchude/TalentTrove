import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  clearedSessionCookieHeader,
  readSession,
  sealSession,
  sessionCookieHeader,
} from './session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sealSession / readSession', () => {
  it('round-trips session data through a cookie header', async () => {
    const sealed = await sealSession({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
    const session = await readSession(`${SESSION_COOKIE_NAME}=${sealed}`);
    expect(session).toEqual({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
  });

  it('returns an empty session when there is no cookie at all', async () => {
    expect(await readSession(null)).toEqual({});
  });

  it('returns an empty session for a tampered cookie value, rather than throwing', async () => {
    // Corrupting a byte WITHIN the sealed string, not appending after it: iron-session's
    // sealed format tolerates (and silently ignores) trailing bytes appended past the end
    // of a valid seal — appending garbage there still unseals to the original data, verified
    // directly against the real library during this plan's execution. Flipping a byte inside
    // the seal's fixed-length prefix (password id + salt, always present regardless of
    // payload size) is what actually invalidates the HMAC and proves tampering is caught.
    const sealed = await sealSession({ accessToken: 'a1' });
    const tampered = `${sealed.slice(0, 20)}X${sealed.slice(21)}`;
    expect(await readSession(`${SESSION_COOKIE_NAME}=${tampered}`)).toEqual({});
  });

  it('reads the right cookie out of a header carrying several', async () => {
    const sealed = await sealSession({ accessToken: 'a1' });
    const header = `other=1; ${SESSION_COOKIE_NAME}=${sealed}; another=2`;
    expect(await readSession(header)).toEqual({ accessToken: 'a1' });
  });
});

describe('sessionCookieHeader / clearedSessionCookieHeader', () => {
  it('sets the cookie httpOnly and scoped to the whole site', () => {
    // Not asserting `Secure` here: whether it's set depends on NODE_ENV
    // (see the dedicated test below) — under a plain `vitest run`,
    // NODE_ENV is 'test', not 'production', so Secure is correctly absent.
    // Chrome/Firefox treat http://localhost as trustworthy and store a
    // Secure cookie there anyway, but Safari does not, so the app only
    // sends Secure in production, letting local sign-in work in Safari too.
    const header = sessionCookieHeader('sealed-value');
    expect(header).toContain(`${SESSION_COOKIE_NAME}=sealed-value`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(clearedSessionCookieHeader()).toContain('Max-Age=0');
  });

  it('only sets Secure when NODE_ENV is production', async () => {
    // COOKIE_SECURITY_FLAG is computed once at module load time, so
    // flipping process.env.NODE_ENV after the module is already imported
    // (as the rest of this file does) would not change its value. Reset
    // the module registry and re-import fresh under each NODE_ENV to
    // observe the real behavior instead of just re-asserting the current
    // environment's value.
    try {
      vi.resetModules();
      vi.stubEnv('NODE_ENV', 'production');
      const prodModule = await import('./session.ts');
      expect(prodModule.sessionCookieHeader('sealed-value')).toContain('Secure');

      vi.resetModules();
      vi.stubEnv('NODE_ENV', 'development');
      const devModule = await import('./session.ts');
      expect(devModule.sessionCookieHeader('sealed-value')).not.toContain('Secure');
    } finally {
      vi.resetModules();
    }
  });
});

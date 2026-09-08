import { beforeEach, describe, expect, it } from 'vitest';
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
  it('sets the cookie httpOnly, secure, and scoped to the whole site', () => {
    const header = sessionCookieHeader('sealed-value');
    expect(header).toContain(`${SESSION_COOKIE_NAME}=sealed-value`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(clearedSessionCookieHeader()).toContain('Max-Age=0');
  });
});

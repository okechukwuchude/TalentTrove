import { beforeEach, describe, expect, it } from 'vitest';
import { requireSession, withRenewedCookie } from './require-session.ts';
import { SESSION_COOKIE_NAME, readSession, sealSession, sessionCookieHeader } from './session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe('requireSession', () => {
  it('returns the pass and session when a valid session cookie is present', async () => {
    const sealed = await sealSession({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;
    const request = new Request('http://localhost/api/profile', { headers: { cookie } });
    const result = await requireSession(request);
    expect('unauthorized' in result).toBe(false);
    if ('unauthorized' in result) return;
    expect(result.pass).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
    expect(result.session.email).toBe('a@example.com');
  });

  it('returns a 401 response when there is no session cookie', async () => {
    const request = new Request('http://localhost/api/profile');
    const result = await requireSession(request);
    expect('unauthorized' in result).toBe(true);
    if (!('unauthorized' in result)) return;
    expect(result.unauthorized.status).toBe(401);
  });
});

describe('withRenewedCookie', () => {
  it('leaves the response untouched when nothing was renewed', async () => {
    const response = Response.json({ ok: true });
    const result = await withRenewedCookie({ accessToken: 'a1' }, response, undefined);
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('re-seals the session with the renewed tokens, keeping the rest of the session intact', async () => {
    const original = { accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' };
    const response = Response.json({ ok: true });
    const result = await withRenewedCookie(original, response, { accessToken: 'a2', refreshToken: 'r2' });
    const setCookie = result.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    const sealedValue = setCookie!.split(';')[0]!.split('=').slice(1).join('=');
    const rereadSession = await readSession(`${SESSION_COOKIE_NAME}=${sealedValue}`);
    expect(rereadSession).toEqual({ accessToken: 'a2', refreshToken: 'r2', email: 'a@example.com' });
  });
});

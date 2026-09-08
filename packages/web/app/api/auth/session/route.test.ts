import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe('GET /api/auth/session', () => {
  it('reports signed out when there is no session cookie', async () => {
    const response = await GET(new Request('http://localhost/api/auth/session'));
    expect(await response.json()).toEqual({ signedIn: false });
  });

  it('reports signed in with the email when a valid session cookie is present', async () => {
    const sealed = await sealSession({ accessToken: 'a1', email: 'a@example.com' });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;
    const request = new Request('http://localhost/api/auth/session', { headers: { cookie } });
    const response = await GET(request);
    expect(await response.json()).toEqual({ signedIn: true, email: 'a@example.com' });
  });
});

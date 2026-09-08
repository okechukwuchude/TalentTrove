import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function signedInRequest(url: string): Promise<Request> {
  const sealed = await sealSession({ accessToken: 'a1' });
  const cookie = sessionCookieHeader(sealed).split(';')[0]!;
  return new Request(url, { headers: { cookie } });
}

describe('GET /api/profile', () => {
  it('refuses a signed-out request', async () => {
    const response = await GET(new Request('http://localhost/api/profile'));
    expect(response.status).toBe(401);
  });

  it('returns the rows the server sent back', async () => {
    const rows = [{ name: 'resume', kind: 'file', bytes: 55000 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows })));
    const response = await GET(await signedInRequest('http://localhost/api/profile'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows });
  });

  it('surfaces the server error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'server unavailable' }, 500)));
    const response = await GET(await signedInRequest('http://localhost/api/profile'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server unavailable' });
  });
});

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

describe('GET /api/companies', () => {
  it('refuses a signed-out request', async () => {
    const response = await GET(new Request('http://localhost/api/companies?q=acme'));
    expect(response.status).toBe(401);
  });

  it('looks up employers by the q parameter and returns the rows', async () => {
    const rows = [{ id: 'c1', name: 'Acme Inc', posting_count: 12 }];
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows }));
    vi.stubGlobal('fetch', doFetch);

    const response = await GET(await signedInRequest('http://localhost/api/companies?q=acme'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows });
    const [calledPath] = doFetch.mock.calls[0] as [string];
    expect(calledPath).toContain('/companies?q=acme&limit=10');
  });

  it('surfaces the server error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'server unavailable' }, 500)));
    const response = await GET(await signedInRequest('http://localhost/api/companies?q=acme'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server unavailable' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route.ts';
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

async function signedInRequest(init: RequestInit = {}): Promise<Request> {
  const sealed = await sealSession({ accessToken: 'a1' });
  const cookie = sessionCookieHeader(sealed).split(';')[0]!;
  return new Request('http://localhost/api/tabs', { ...init, headers: { ...init.headers, cookie } });
}

describe('GET /api/tabs', () => {
  it('refuses a signed-out request', async () => {
    const response = await GET(new Request('http://localhost/api/tabs'));
    expect(response.status).toBe(401);
  });

  it('returns the rows the server sent back', async () => {
    const rows = [{ name: 'shortlist', items: 3 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows })));
    const response = await GET(await signedInRequest());
    expect(await response.json()).toEqual({ rows });
  });

  it('requests a generous page size from the upstream server', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', doFetch);
    await GET(await signedInRequest());
    const [calledPath] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toContain('/tab?limit=100');
  });
});

describe('POST /api/tabs', () => {
  it('refuses a request with no name', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const response = await POST(
      await signedInRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('creates the tab with an optional description', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ name: 'shortlist', items: 0 }] }));
    vi.stubGlobal('fetch', doFetch);
    const response = await POST(
      await signedInRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'shortlist', description: 'roles to apply to' }),
      }),
    );
    expect(response.status).toBe(200);
    const [calledPath, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toContain('/tab');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'shortlist', description: 'roles to apply to' });
  });

  it('surfaces the server error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'server unavailable' }, 500)));
    const response = await POST(
      await signedInRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'shortlist' }),
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server unavailable' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route.ts';
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

async function signedInRequest(body: unknown): Promise<Request> {
  const sealed = await sealSession({ accessToken: 'a1' });
  const cookie = sessionCookieHeader(sealed).split(';')[0]!;
  return new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/search', () => {
  it('refuses a signed-out request', async () => {
    const request = new Request('http://localhost/api/search', { method: 'POST', body: '{}' });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('forwards the filters to /search and returns rows and cursor', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer' }], cursor: 'c2' }));
    vi.stubGlobal('fetch', doFetch);

    const response = await POST(await signedInRequest({ q: 'engineer', limit: '20' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [{ id: 'p1', title: 'Staff Engineer' }], cursor: 'c2' });
    const [calledPath, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toContain('/search');
    expect(JSON.parse(init.body as string)).toEqual({ q: 'engineer', limit: '20' });
  });

  it('surfaces the server error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'server unavailable' }, 500)));
    const response = await POST(await signedInRequest({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server unavailable' });
  });

  it('passes through the interpretation object when the server includes one', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        rows: [{ id: 'p1', title: 'Staff Engineer' }],
        cursor: 'c2',
        interpretation: { covered: 3, total: 10 },
      }),
    );
    vi.stubGlobal('fetch', doFetch);

    const response = await POST(await signedInRequest({ q: 'engineer' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rows: [{ id: 'p1', title: 'Staff Engineer' }],
      cursor: 'c2',
      interpretation: { covered: 3, total: 10 },
    });
  });

  it('drops disallowed fields (semantic, from_profile, min_match, preview) before forwarding to /search', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null }));
    vi.stubGlobal('fetch', doFetch);

    await POST(
      await signedInRequest({
        q: 'engineer',
        semantic: true,
        from_profile: true,
        min_match: 0.8,
        preview: true,
        all: true,
      }),
    );

    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ q: 'engineer' });
  });
});

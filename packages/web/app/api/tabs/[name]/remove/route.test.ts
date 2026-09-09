import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route.ts';
import { sealSession, sessionCookieHeader } from '../../../../../lib/session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function signedInHeaders(): Promise<Record<string, string>> {
  const sealed = await sealSession({ accessToken: 'a1' });
  return { cookie: sessionCookieHeader(sealed).split(';')[0]! };
}

describe('POST /api/tabs/[name]/remove', () => {
  it('refuses a request with no item_ids', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const request = new Request('http://localhost/api/tabs/shortlist/remove', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: Promise.resolve({ name: 'shortlist' }) });
    expect(response.status).toBe(400);
  });

  it('removes the item ids and returns rows/not_found/coverage', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rows: [{ id: 'p1' }], not_found: ['i9'], coverage: { covered: 1, total: 2 } }));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/tabs/shortlist/remove', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: ['i1', 'i9'] }),
    });
    const response = await POST(request, { params: Promise.resolve({ name: 'shortlist' }) });
    expect(await response.json()).toEqual({
      rows: [{ id: 'p1' }],
      not_found: ['i9'],
      coverage: { covered: 1, total: 2 },
    });
    const [calledPath, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toContain('/tab/shortlist/remove');
    expect(JSON.parse(init.body as string)).toEqual({ item_ids: ['i1', 'i9'] });
  });
});

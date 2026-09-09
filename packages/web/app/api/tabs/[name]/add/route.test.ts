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

describe('POST /api/tabs/[name]/add', () => {
  it('refuses a request with no ids', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const request = new Request('http://localhost/api/tabs/shortlist/add', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: Promise.resolve({ name: 'shortlist' }) });
    expect(response.status).toBe(400);
  });

  it('adds the ids and returns rows/already_present/unknown/coverage', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({ rows: [{ id: 'p1' }], already_present: ['p2'], unknown: ['p3'], coverage: { covered: 1, total: 3 } }),
    );
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/tabs/shortlist/add', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['p1', 'p2', 'p3'] }),
    });
    const response = await POST(request, { params: Promise.resolve({ name: 'shortlist' }) });
    expect(await response.json()).toEqual({
      rows: [{ id: 'p1' }],
      already_present: ['p2'],
      unknown: ['p3'],
      coverage: { covered: 1, total: 3 },
    });
    const [calledPath, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toContain('/tab/shortlist/add');
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['p1', 'p2', 'p3'] });
  });
});

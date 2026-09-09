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

describe('POST /api/tabs/[name]/rename', () => {
  it('refuses a request with no new name', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const request = new Request('http://localhost/api/tabs/shortlist/rename', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: Promise.resolve({ name: 'shortlist' }) });
    expect(response.status).toBe(400);
  });

  it('renames the tab', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ name: 'applied', items: 3 }] }));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/tabs/shortlist/rename', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'applied' }),
    });
    const response = await POST(request, { params: Promise.resolve({ name: 'shortlist' }) });
    expect(await response.json()).toEqual({ renamed: true });
    const [calledPath, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toContain('/tab/shortlist/rename');
    expect(JSON.parse(init.body as string)).toEqual({ to: 'applied' });
  });
});

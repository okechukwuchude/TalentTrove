import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET } from './route.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

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

const params = (name: string) => ({ params: Promise.resolve({ name }) });

describe('GET /api/tabs/[name]', () => {
  it('refuses a signed-out request', async () => {
    const response = await GET(new Request('http://localhost/api/tabs/shortlist'), params('shortlist'));
    expect(response.status).toBe(401);
  });

  it('forwards limit/cursor and returns rows, cursor, and no_longer_present', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({ rows: [{ id: 'p1' }], cursor: 'c2', no_longer_present: [{ posting_id: 'p9', item_id: 'i9' }] }),
    );
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/tabs/shortlist?limit=20&cursor=c1', {
      headers: await signedInHeaders(),
    });
    const response = await GET(request, params('shortlist'));
    expect(await response.json()).toEqual({
      rows: [{ id: 'p1' }],
      cursor: 'c2',
      no_longer_present: [{ posting_id: 'p9', item_id: 'i9' }],
      coverage: undefined,
    });
    const [calledPath] = doFetch.mock.calls[0] as [string];
    expect(calledPath).toContain('/tab/shortlist?limit=20&cursor=c1');
  });
});

describe('DELETE /api/tabs/[name]', () => {
  it('deletes the tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] })));
    const request = new Request('http://localhost/api/tabs/shortlist', {
      method: 'DELETE',
      headers: await signedInHeaders(),
    });
    const response = await DELETE(request, params('shortlist'));
    expect(await response.json()).toEqual({ deleted: true });
  });
});

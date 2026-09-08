import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route.ts';
import { SESSION_COOKIE_NAME } from '../../../../lib/session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('POST /api/auth/handoff', () => {
  it('sets a session cookie when the code trades for a pass', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a1', refresh_token: 'r1', email: 'a@example.com' })),
    );
    const request = new Request('http://localhost/api/auth/handoff', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(SESSION_COOKIE_NAME);
    expect(await response.json()).toEqual({ email: 'a@example.com' });
  });

  it('refuses an empty code without calling the server at all', async () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/auth/handoff', {
      method: 'POST',
      body: JSON.stringify({ code: '  ' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal for an already-used or expired code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'that code has expired' }, 400)));
    const request = new Request('http://localhost/api/auth/handoff', {
      method: 'POST',
      body: JSON.stringify({ code: '000000' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'that code has expired' });
  });
});

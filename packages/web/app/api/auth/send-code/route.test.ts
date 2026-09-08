import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('POST /api/auth/send-code', () => {
  it('asks the server to email a code, and reports success', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/send-code'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('refuses an empty email without calling the server at all', async () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email: '  ' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal (e.g. rate limited)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'too many codes requested, try again later' }, 429)),
    );
    const request = new Request('http://localhost/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'too many codes requested, try again later' });
  });
});

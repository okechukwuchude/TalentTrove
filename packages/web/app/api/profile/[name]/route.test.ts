import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from './route.ts';
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

describe('GET /api/profile/[name]', () => {
  it('asks the server for the document including its text', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ text: 'hello', stored: true }] }));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/profile/background', { headers: await signedInHeaders() });
    const response = await GET(request, params('background'));
    expect(await response.json()).toEqual({ text: 'hello', stored: true });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/profile/background?include=text'),
      expect.anything(),
    );
  });

  it('treats a document the server 404s (never stored, no built-in default) as an empty document', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'no document named background is stored in this profile' }, 404));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/profile/background', { headers: await signedInHeaders() });
    const response = await GET(request, params('background'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '', stored: false });
  });
});

describe('POST /api/profile/[name]', () => {
  it('sends a JSON body for a text document', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ bytes: 5 }] }));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/profile/background', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    const response = await POST(request, params('background'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: 5 });
    const [, init] = doFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ text: 'hello' }));
  });

  it('forwards raw bytes for a PDF upload, carrying the filename in the query string', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ pages: 1, characters: 100, bytes: 9 }] }));
    vi.stubGlobal('fetch', doFetch);
    const bytes = new Uint8Array([1, 2, 3]);
    const request = new Request('http://localhost/api/profile/resume?filename=my-resume.pdf', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/pdf' },
      body: bytes,
    });
    const response = await POST(request, params('resume'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pages: 1, characters: 100, bytes: 9 });
    const [calledPath, init] = doFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(calledPath).toContain('/profile/resume?filename=my-resume.pdf');
    expect(init.headers['Content-Type']).toBe('application/pdf');
  });

  it('refuses a PDF upload over the 10MB cap without calling the server', async () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/profile/resume?filename=big.pdf', {
      method: 'POST',
      headers: {
        ...(await signedInHeaders()),
        'Content-Type': 'application/pdf',
        'Content-Length': String(10 * 1024 * 1024 + 1),
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const response = await POST(request, params('resume'));
    expect(response.status).toBe(413);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('refuses to store a request with no text field, rather than silently storing empty text', async () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/profile/background', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, params('background'));
    expect(response.status).toBe(400);
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/profile/[name]', () => {
  it('deletes the document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    const request = new Request('http://localhost/api/profile/judge-prompt', {
      method: 'DELETE',
      headers: await signedInHeaders(),
    });
    const response = await DELETE(request, params('judge-prompt'));
    expect(await response.json()).toEqual({ deleted: true });
  });

  it('treats deleting a document that was never stored as already done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)));
    const request = new Request('http://localhost/api/profile/judge-prompt', {
      method: 'DELETE',
      headers: await signedInHeaders(),
    });
    const response = await DELETE(request, params('judge-prompt'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
  });
});

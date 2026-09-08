# Profile & CV Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can upload their resume as a PDF, edit their `constraints`/`background`/`preferences` text documents, and manage the `judge-prompt`/`quick-judge-prompt` overrides — reaching parity with `pinloop profile *`.

**Architecture:** BFF route handlers under `app/api/profile/*` proxy to the same `/profile` endpoints the CLI already calls (`GET /profile` for the list, `GET/POST/DELETE /profile/{name}` per document), reusing `callAsAccount` from Plan 2 (extended here to carry raw bytes for the PDF upload, alongside its existing JSON-body support). A new `requireSession` guard protects every route, and — because a mid-request token renewal must be persisted back into the cookie or a later request could fail outright — every protected route re-seals the session when `callAsAccount` reports a `renewedPass`. TanStack Query drives the client side: one query per document's content, one mutation each for saving text, uploading the resume, and resetting a prompt to default. `/profile` itself is a Server Component that redirects a signed-out visitor to `/sign-in`, delegating the actual interactive editor to client components underneath it.

**Tech Stack:** `@tanstack/react-query` (added here), everything else from Plans 1–2.

**Spec:** `docs/superpowers/specs/2026-09-08-web-app-migration-design.md` (see "Profile & CV upload, in detail")

**Depends on:** `docs/superpowers/plans/2026-09-08-monorepo-restructuring.md` and `docs/superpowers/plans/2026-09-08-auth-and-session.md`.

## Global Constraints

- Every `/api/profile/*` route requires a valid session (`requireSession`); an unauthenticated request gets `401`. The `/profile` page itself redirects a signed-out visitor to `/sign-in` server-side, before any client code runs.
- Client-side file validation (MIME/extension, size) is a fast-fail UX convenience only. The server's own PDF-header and cap checks remain the real authority — never treat the client check as the actual gate.
- Every byte cap shown in the UI (`PER_DOCUMENT_CAP`, `WHOLE_PROFILE_CAP`, `FILE_CAP`) is imported from `@pinloop/shared`, never hand-copied, so it can't drift from the value the CLI and server already agree on.
- Whenever `callAsAccount` reports a `renewedPass` (the access token was refreshed mid-request), the route handler's response must re-seal and re-set the session cookie before returning. Skipping this risks a subsequent request failing outright if the backend's refresh token turns out to be single-use (the spec's still-open question about refresh token rotation) — the old token would still be the one sitting in the cookie.
- `"type": "module"` and the monorepo's `strict`/`noUncheckedIndexedAccess` TypeScript conventions carry over.

---

### Task 1: Extend the BFF proxy for raw-bytes uploads, and add the session guard

**Files:**
- Modify: `packages/web/lib/pinloop-server.ts` (add `bytes`/`contentType` support to `callAsAccount`)
- Modify: `packages/web/lib/pinloop-server.test.ts` (new test for the bytes path)
- Create: `packages/web/lib/require-session.ts`
- Create: `packages/web/lib/require-session.test.ts`

**Interfaces:**
- Consumes: `readSession`, `sealSession`, `sessionCookieHeader`, `type SessionData` (Plan 2, Task 2); `type Pass` (Plan 2, Task 1, now widened).
- Produces: `callAsAccount` now also accepts `{ bytes: Uint8Array; contentType: string }` in its options; `requireSession(request): Promise<{ pass: Pass; session: SessionData } | { unauthorized: Response }>`; `withRenewedCookie(session: SessionData, response: Response, renewedPass: Pass | undefined): Promise<Response>`. Task 2's routes use all of this.

- [ ] **Step 1: Write the failing test for raw-bytes calls**

Add to `packages/web/lib/pinloop-server.test.ts`:

```typescript
describe('callAsAccount with raw bytes', () => {
  it('sends the bytes as the body under the given content type, not as JSON', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ bytes: 3 }));
    const bytes = new Uint8Array([1, 2, 3]);
    await callAsAccount(
      { accessToken: 'a1' },
      '/profile/resume?filename=resume.pdf',
      { method: 'POST', bytes, contentType: 'application/pdf' },
      doFetch as unknown as typeof fetch,
    );
    const [, init] = doFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Content-Type']).toBe('application/pdf');
    expect(init.body).toBe(bytes);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run packages/web/lib/pinloop-server.test.ts
```

Expected: FAIL — `bytes`/`contentType` aren't accepted by the current options type/implementation, so `init.headers['Content-Type']` is `undefined`, not `'application/pdf'`.

- [ ] **Step 3: Extend the implementation**

In `packages/web/lib/pinloop-server.ts`, widen `CallOptions` and `rawCall`:

```typescript
type CallOptions = {
  method?: string;
  body?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  token?: string;
};

async function rawCall(
  path: string,
  options: CallOptions,
  doFetch: typeof fetch,
): Promise<{ json: unknown; status: number }> {
  const headers: Record<string, string> = { 'pinloop-web-version': '0.0.0' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.bytes !== undefined) headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await doFetch(`${SERVER_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body:
      options.bytes !== undefined
        ? options.bytes
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
  });

  // ...unchanged from here down (status/json handling)
```

And widen `callAsAccount`'s public `options` parameter type to match:

```typescript
export async function callAsAccount(
  pass: Pass,
  path: string,
  options: { method?: string; body?: unknown; bytes?: Uint8Array; contentType?: string } = {},
  doFetch: typeof fetch = fetch,
): Promise<{ json: unknown; status: number; renewedPass?: Pass }> {
  // body unchanged — it already spreads `...options` into rawCall's options
```

- [ ] **Step 4: Run it, verify it passes, then run the whole file**

```bash
npx vitest run packages/web/lib/pinloop-server.test.ts
```

Expected: 14 passed, 0 failed. (This file has grown since this plan was written — Plan 2's own final review added a test, and a post-merge sign-in rework added five more for direct email-code verification — so it's 13 existing tests plus this one, not the "6 from Plan 2" originally assumed here. Whatever the actual pre-existing count is, confirm all of them still pass alongside the new one — that's what actually matters.)

- [ ] **Step 5: Write the failing tests for `require-session.ts`**

```typescript
// packages/web/lib/require-session.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { requireSession, withRenewedCookie } from './require-session.ts';
import { SESSION_COOKIE_NAME, readSession, sealSession, sessionCookieHeader } from './session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe('requireSession', () => {
  it('returns the pass and session when a valid session cookie is present', async () => {
    const sealed = await sealSession({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;
    const request = new Request('http://localhost/api/profile', { headers: { cookie } });
    const result = await requireSession(request);
    expect('unauthorized' in result).toBe(false);
    if ('unauthorized' in result) return;
    expect(result.pass).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
    expect(result.session.email).toBe('a@example.com');
  });

  it('returns a 401 response when there is no session cookie', async () => {
    const request = new Request('http://localhost/api/profile');
    const result = await requireSession(request);
    expect('unauthorized' in result).toBe(true);
    if (!('unauthorized' in result)) return;
    expect(result.unauthorized.status).toBe(401);
  });
});

describe('withRenewedCookie', () => {
  it('leaves the response untouched when nothing was renewed', async () => {
    const response = Response.json({ ok: true });
    const result = await withRenewedCookie({ accessToken: 'a1' }, response, undefined);
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('re-seals the session with the renewed tokens, keeping the rest of the session intact', async () => {
    const original = { accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' };
    const response = Response.json({ ok: true });
    const result = await withRenewedCookie(original, response, { accessToken: 'a2', refreshToken: 'r2' });
    const setCookie = result.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    const sealedValue = setCookie!.split(';')[0]!.split('=').slice(1).join('=');
    const rereadSession = await readSession(`${SESSION_COOKIE_NAME}=${sealedValue}`);
    expect(rereadSession).toEqual({ accessToken: 'a2', refreshToken: 'r2', email: 'a@example.com' });
  });
});
```

- [ ] **Step 6: Run it, verify it fails, then write `require-session.ts`**

```bash
npx vitest run packages/web/lib/require-session.test.ts
```

Expected: FAIL — the file doesn't exist yet.

```typescript
// packages/web/lib/require-session.ts
import type { Pass } from './pinloop-server.ts';
import { type SessionData, readSession, sealSession, sessionCookieHeader } from './session.ts';

export type SessionResult = { pass: Pass; session: SessionData } | { unauthorized: Response };

export async function requireSession(request: Request): Promise<SessionResult> {
  const session = await readSession(request.headers.get('cookie'));
  if (!session.accessToken) {
    return { unauthorized: Response.json({ error: 'not signed in' }, { status: 401 }) };
  }
  return {
    pass: { accessToken: session.accessToken, refreshToken: session.refreshToken },
    session,
  };
}

export async function withRenewedCookie(
  originalSession: SessionData,
  response: Response,
  renewedPass: Pass | undefined,
): Promise<Response> {
  if (!renewedPass) return response;
  const sealed = await sealSession({
    ...originalSession,
    accessToken: renewedPass.accessToken,
    refreshToken: renewedPass.refreshToken,
  });
  response.headers.append('Set-Cookie', sessionCookieHeader(sealed));
  return response;
}
```

- [ ] **Step 7: Run it, verify it passes**

```bash
npx vitest run packages/web/lib/require-session.test.ts
```

Expected: 4 passed, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add packages/web/lib
git commit -m "Support raw-bytes uploads in the BFF proxy, add the session guard"
```

---

### Task 2: Profile BFF routes

**Files:**
- Create: `packages/web/app/api/profile/route.ts`
- Create: `packages/web/app/api/profile/route.test.ts`
- Create: `packages/web/app/api/profile/[name]/route.ts`
- Create: `packages/web/app/api/profile/[name]/route.test.ts`

**Interfaces:**
- Consumes: `callAsAccount`, `PinloopServerError` (Task 1's extended version); `requireSession`, `withRenewedCookie` (Task 1).
- Produces: `GET /api/profile` (list), `GET /api/profile/[name]` (one document, with text), `POST /api/profile/[name]` (store — JSON `{text}` or raw PDF bytes depending on `Content-Type`), `DELETE /api/profile/[name]` (remove, used for "reset to default"). Task 3's hooks call all four.

- [ ] **Step 1: Write the failing tests for `GET /api/profile`**

```typescript
// packages/web/app/api/profile/route.test.ts
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

describe('GET /api/profile', () => {
  it('refuses a signed-out request', async () => {
    const response = await GET(new Request('http://localhost/api/profile'));
    expect(response.status).toBe(401);
  });

  it('returns the rows the server sent back', async () => {
    const rows = [{ name: 'resume', kind: 'file', bytes: 55000 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows })));
    const response = await GET(await signedInRequest('http://localhost/api/profile'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows });
  });

  it('surfaces the server error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'server unavailable' }, 500)));
    const response = await GET(await signedInRequest('http://localhost/api/profile'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server unavailable' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails, then write `route.ts`**

```bash
npx vitest run packages/web/app/api/profile/route.test.ts
```

Expected: FAIL — the route doesn't exist yet.

```typescript
// packages/web/app/api/profile/route.ts
import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, '/profile');
    const rows = (json as { rows?: unknown } | undefined)?.rows ?? [];
    return withRenewedCookie(auth.session, Response.json({ rows }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not load your profile';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
```

Run again — expected: 3 passed, 0 failed.

- [ ] **Step 3: Write the failing tests for `[name]/route.ts`**

```typescript
// packages/web/app/api/profile/[name]/route.test.ts
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
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ text: 'hello', stored: true }));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/profile/background', { headers: await signedInHeaders() });
    const response = await GET(request, params('background'));
    expect(await response.json()).toEqual({ text: 'hello', stored: true });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/profile/background?include=text'),
      expect.anything(),
    );
  });
});

describe('POST /api/profile/[name]', () => {
  it('sends a JSON body for a text document', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ bytes: 5 }));
    vi.stubGlobal('fetch', doFetch);
    const request = new Request('http://localhost/api/profile/background', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    const response = await POST(request, params('background'));
    expect(response.status).toBe(200);
    const [, init] = doFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ text: 'hello' }));
  });

  it('forwards raw bytes for a PDF upload, carrying the filename in the query string', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ pages: 1, characters: 100, bytes: 9 }));
    vi.stubGlobal('fetch', doFetch);
    const bytes = new Uint8Array([1, 2, 3]);
    const request = new Request('http://localhost/api/profile/resume?filename=my-resume.pdf', {
      method: 'POST',
      headers: { ...(await signedInHeaders()), 'Content-Type': 'application/pdf' },
      body: bytes,
    });
    const response = await POST(request, params('resume'));
    expect(response.status).toBe(200);
    const [calledPath, init] = doFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(calledPath).toContain('/profile/resume?filename=my-resume.pdf');
    expect(init.headers['Content-Type']).toBe('application/pdf');
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
```

- [ ] **Step 4: Run it, verify it fails, then write `[name]/route.ts`**

```bash
npx vitest run "packages/web/app/api/profile/[name]/route.test.ts"
```

Expected: FAIL — the route doesn't exist yet.

```typescript
// packages/web/app/api/profile/[name]/route.ts
import { PinloopServerError, callAsAccount } from '../../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  try {
    const { json, renewedPass } = await callAsAccount(
      auth.pass,
      `/profile/${encodeURIComponent(name)}?include=text`,
    );
    return withRenewedCookie(auth.session, Response.json(json as Record<string, unknown>), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not load '${name}'`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;
  const contentType = request.headers.get('content-type') ?? '';

  try {
    let result: Awaited<ReturnType<typeof callAsAccount>>;
    if (contentType.includes('application/pdf')) {
      const filename = new URL(request.url).searchParams.get('filename') ?? 'resume.pdf';
      const bytes = new Uint8Array(await request.arrayBuffer());
      result = await callAsAccount(
        auth.pass,
        `/profile/${encodeURIComponent(name)}?filename=${encodeURIComponent(filename)}`,
        { method: 'POST', bytes, contentType: 'application/pdf' },
      );
    } else {
      const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
      const text = typeof body?.text === 'string' ? body.text : '';
      result = await callAsAccount(auth.pass, `/profile/${encodeURIComponent(name)}`, {
        method: 'POST',
        body: { text },
      });
    }
    const response = Response.json((result.json ?? {}) as Record<string, unknown>);
    return withRenewedCookie(auth.session, response, result.renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not store '${name}'`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  try {
    const { renewedPass } = await callAsAccount(auth.pass, `/profile/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    return withRenewedCookie(auth.session, Response.json({ deleted: true }), renewedPass);
  } catch (error) {
    // Deleting a document that was never stored is treated as already done —
    // mirrors removeDocument() in pinloop.ts today.
    if (error instanceof PinloopServerError && error.status === 404) {
      return Response.json({ deleted: true });
    }
    const message = error instanceof PinloopServerError ? error.message : `could not delete '${name}'`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
```

- [ ] **Step 5: Run it, verify it passes**

```bash
npx vitest run "packages/web/app/api/profile/[name]/route.test.ts"
```

Expected: 5 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/api/profile
git commit -m "Add profile BFF routes: list, get, store, delete"
```

---

### Task 3: React Query provider and data hooks

**Files:**
- Create: `packages/web/app/query-provider.tsx`
- Modify: `packages/web/app/layout.tsx` (wrap children in `QueryProvider`)
- Create: `packages/web/lib/profile-queries.ts`
- Create: `packages/web/lib/profile-queries.test.tsx`
- Modify: `packages/web/package.json` (add `@tanstack/react-query`)

**Interfaces:**
- Consumes: nothing new (calls the routes built in Task 2 via `fetch`).
- Produces: `useProfileDocuments()`, `useProfileDocumentText(name)`, `useSaveTextDocument(name)`, `useUploadResume()`, `useResetToDefault(name)`. Task 4's components use all five.

- [ ] **Step 1: Add `@tanstack/react-query`**

```json
// packages/web/package.json — add to "dependencies"
"@tanstack/react-query": "^5.59.0"
```

```bash
npm install
```

- [ ] **Step 2: Write `QueryProvider` and wire it into the root layout**

```tsx
// packages/web/app/query-provider.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

Modify `packages/web/app/layout.tsx` to wrap `{children}`. **Note:** this plan was written before a
post-merge rename of the app to "TalentTrove" — the real current file has `title: 'TalentTrove'`, not
`title: 'Pinloop'` as shown below. Keep whatever the file's current title value actually is; only add
the `<QueryProvider>` wrap, don't revert the title:

```tsx
import type { ReactNode } from 'react';
import { QueryProvider } from './query-provider.tsx';

export const metadata = {
  title: 'TalentTrove',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Write the failing test for the first hook**

```tsx
// packages/web/lib/profile-queries.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useProfileDocuments } from './profile-queries.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useProfileDocuments', () => {
  it('fetches the list of stored documents', async () => {
    const rows = [{ name: 'resume', kind: 'file', bytes: 55000 }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ rows }), { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const { result } = renderHook(() => useProfileDocuments(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(rows));
  });
});
```

- [ ] **Step 4: Run it, verify it fails, then write `profile-queries.ts`**

```bash
npx vitest run packages/web/lib/profile-queries.test.tsx
```

Expected: FAIL — the file doesn't exist yet.

```typescript
// packages/web/lib/profile-queries.ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type ProfileDocumentSummary = {
  name: string;
  kind: 'text' | 'file';
  bytes: number;
  updated_at?: string;
  original_filename?: string;
};

type ProfileDocumentDetail = {
  text?: string;
  stored?: boolean;
};

type ResumeUploadResult = {
  pages?: number;
  pages_read?: number;
  characters?: number;
  note?: string;
  bytes?: number;
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'request failed');
  return data;
}

export function useProfileDocuments() {
  return useQuery({
    queryKey: ['profile', 'documents'],
    queryFn: () => fetchJson<{ rows: ProfileDocumentSummary[] }>('/api/profile').then((data) => data.rows),
  });
}

export function useProfileDocumentText(name: string) {
  return useQuery({
    queryKey: ['profile', 'document', name, 'text'],
    queryFn: () => fetchJson<ProfileDocumentDetail>(`/api/profile/${name}`),
  });
}

export function useSaveTextDocument(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      fetchJson(`/api/profile/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useUploadResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      fetchJson<ResumeUploadResult>(`/api/profile/resume?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useResetToDefault(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson(`/api/profile/${name}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
```

The four mutation hooks aren't given their own isolated tests here — they're exercised end-to-end through real component interaction in Task 4, which proves the actual integration rather than a hook in isolation.

- [ ] **Step 5: Run it, verify it passes**

```bash
npx vitest run packages/web/lib/profile-queries.test.tsx
```

Expected: 1 passed, 0 failed.

- [ ] **Step 6: Build to confirm the provider wiring compiles**

```bash
npm run build -w packages/web
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/query-provider.tsx packages/web/app/layout.tsx packages/web/lib/profile-queries.ts packages/web/lib/profile-queries.test.tsx packages/web/package.json
git commit -m "Add React Query provider and profile data hooks"
```

---

### Task 4: Resume upload and text document components

**Files:**
- Create: `packages/web/app/profile/resume-card.tsx`
- Create: `packages/web/app/profile/resume-card.test.tsx`
- Create: `packages/web/app/profile/text-document-card.tsx`
- Create: `packages/web/app/profile/text-document-card.test.tsx`

**Interfaces:**
- Consumes: `useUploadResume` (Task 3), `FILE_CAP` (`@pinloop/shared`); `useProfileDocumentText`, `useSaveTextDocument`, `useResetToDefault` (Task 3), `PER_DOCUMENT_CAP` (`@pinloop/shared`).
- Produces: `<ResumeCard />`, `<TextDocumentCard name label perDocumentCap resettable? />`. Task 5's page assembles both.

- [ ] **Step 1: Write the failing tests for `ResumeCard`**

```tsx
// packages/web/app/profile/resume-card.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ResumeCard } from './resume-card.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ResumeCard', () => {
  it('rejects a non-PDF file without calling the server', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<ResumeCard />);

    const file = new File(['not a pdf'], 'resume.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [file] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/does not look like a pdf/i);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('rejects a file over the 10MB cap without calling the server', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<ResumeCard />);

    const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'resume.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [bigFile] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/over the 10mb limit/i);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('uploads a valid PDF and shows what the server read out of it', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pages: 2, pages_read: 2, characters: 3400, bytes: 55000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<ResumeCard />);

    const file = new File(['%PDF-1.4 ...'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [file] } });

    expect(await screen.findByText(/2 pages, 2 read, 3,400 characters/i)).toBeInTheDocument();
    expect(doFetch).toHaveBeenCalledWith(
      '/api/profile/resume?filename=resume.pdf',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/pdf' } }),
    );
  });
});
```

- [ ] **Step 2: Run it, verify it fails, then write `resume-card.tsx`**

```bash
npx vitest run packages/web/app/profile/resume-card.test.tsx
```

Expected: FAIL — the component doesn't exist yet.

```tsx
// packages/web/app/profile/resume-card.tsx
'use client';

import { type ChangeEvent, useState } from 'react';
import { FILE_CAP } from '@pinloop/shared';
import { useUploadResume } from '../../lib/profile-queries.ts';

export function ResumeCard() {
  const upload = useUploadResume();
  const [clientError, setClientError] = useState<string | null>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setClientError(null);

    // Fast, client-side checks only — the server's own byte-header check
    // (beginsLikeAPdf in packages/shared) remains the real authority. This
    // catches the two most common mistakes without a round trip, and avoids
    // needing a Buffer polyfill in the browser: beginsLikeAPdf takes a Node
    // Buffer, which the browser doesn't have.
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setClientError('that does not look like a PDF file');
      return;
    }
    if (file.size > FILE_CAP) {
      setClientError(`that file is ${file.size.toLocaleString('en-US')} bytes, over the 10MB limit`);
      return;
    }

    upload.mutate(file);
  }

  return (
    <section>
      <h2>Resume</h2>
      <input type="file" accept="application/pdf" aria-label="Resume" onChange={handleFile} />
      {upload.isPending && <p>Uploading…</p>}
      {clientError && <p role="alert">{clientError}</p>}
      {upload.isError && <p role="alert">{upload.error.message}</p>}
      {upload.isSuccess && (
        <p aria-live="polite">
          Stored
          {typeof upload.data.pages === 'number'
            ? ` — ${upload.data.pages} page${upload.data.pages === 1 ? '' : 's'}, ` +
              `${upload.data.pages_read ?? upload.data.pages} read, ` +
              `${(upload.data.characters ?? 0).toLocaleString('en-US')} characters of text stored`
            : ''}
          {upload.data.note ? ` ${upload.data.note}` : ''}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Run it, verify it passes**

```bash
npx vitest run packages/web/app/profile/resume-card.test.tsx
```

Expected: 3 passed, 0 failed.

- [ ] **Step 4: Write the failing tests for `TextDocumentCard`**

```tsx
// packages/web/app/profile/text-document-card.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TextDocumentCard } from './text-document-card.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('TextDocumentCard', () => {
  it('loads the stored text and shows the byte count against the cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text: 'hello', stored: true })));
    renderWithClient(<TextDocumentCard name="background" label="Background" perDocumentCap={100} />);

    const textarea = await screen.findByLabelText('Background');
    await waitFor(() => expect(textarea).toHaveValue('hello'));
    expect(screen.getByText(/5 \/ 100 bytes/)).toBeInTheDocument();
  });

  it('disables Save until the text changes, and again once over the cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text: 'hi', stored: true })));
    renderWithClient(<TextDocumentCard name="background" label="Background" perDocumentCap={5} />);

    const textarea = await screen.findByLabelText('Background');
    await waitFor(() => expect(textarea).toHaveValue('hi'));
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'hi there' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/over the per-document limit/)).toBeInTheDocument();
  });

  it('saves the edited text', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ text: 'hi', stored: true }))
      .mockResolvedValueOnce(jsonResponse({ bytes: 8 }))
      .mockResolvedValue(jsonResponse({ text: 'hi there', stored: true }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<TextDocumentCard name="background" label="Background" perDocumentCap={100} />);

    const textarea = await screen.findByLabelText('Background');
    await waitFor(() => expect(textarea).toHaveValue('hi'));
    fireEvent.change(textarea, { target: { value: 'hi there' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/profile/background',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'hi there' }) }),
      ),
    );
  });

  it('shows a reset-to-default action only when resettable, hidden while already on the default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text: 'default text', stored: false })));
    renderWithClient(<TextDocumentCard name="judge-prompt" label="Judge prompt" perDocumentCap={100} resettable />);

    await screen.findByLabelText('Judge prompt');
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();
    expect(screen.getByText(/using the default pinloop ships/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it, verify it fails, then write `text-document-card.tsx`**

```bash
npx vitest run packages/web/app/profile/text-document-card.test.tsx
```

Expected: FAIL — the component doesn't exist yet.

```tsx
// packages/web/app/profile/text-document-card.tsx
'use client';

import { useEffect, useState } from 'react';
import { useProfileDocumentText, useResetToDefault, useSaveTextDocument } from '../../lib/profile-queries.ts';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function TextDocumentCard({
  name,
  label,
  perDocumentCap,
  resettable = false,
}: {
  name: string;
  label: string;
  perDocumentCap: number;
  resettable?: boolean;
}) {
  const { data, isLoading } = useProfileDocumentText(name);
  const save = useSaveTextDocument(name);
  const reset = useResetToDefault(name);
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && data?.text !== undefined) setDraft(data.text);
  }, [data?.text, touched]);

  const byteCount = byteLength(draft);
  const overCap = byteCount > perDocumentCap;
  const usingDefault = resettable && data?.stored === false;

  return (
    <section>
      <h2>{label}</h2>
      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <>
          {usingDefault && <p>Using the default Pinloop ships. Edit below to store your own.</p>}
          <textarea
            aria-label={label}
            value={draft}
            onChange={(event) => {
              setTouched(true);
              setDraft(event.target.value);
            }}
          />
          <p aria-live="polite">
            {byteCount.toLocaleString('en-US')} / {perDocumentCap.toLocaleString('en-US')} bytes
            {overCap ? ' — over the per-document limit' : ''}
          </p>
          <button
            type="button"
            disabled={save.isPending || overCap || draft === (data?.text ?? '')}
            onClick={() => save.mutate(draft, { onSuccess: () => setTouched(false) })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {resettable && !usingDefault && (
            <button
              type="button"
              disabled={reset.isPending}
              onClick={() => reset.mutate(undefined, { onSuccess: () => setTouched(false) })}
            >
              {reset.isPending ? 'Resetting…' : 'Reset to default'}
            </button>
          )}
          {save.isError && <p role="alert">{save.error.message}</p>}
          {reset.isError && <p role="alert">{reset.error.message}</p>}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Run it, verify it passes**

```bash
npx vitest run packages/web/app/profile/text-document-card.test.tsx
```

Expected: 4 passed, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/profile/resume-card.tsx packages/web/app/profile/resume-card.test.tsx packages/web/app/profile/text-document-card.tsx packages/web/app/profile/text-document-card.test.tsx
git commit -m "Add resume upload and text document editor components"
```

---

### Task 5: Assemble the profile page, protect it, link to it

**Files:**
- Create: `packages/web/app/profile/whole-profile-usage.tsx`
- Create: `packages/web/app/profile/profile-editor.tsx`
- Create: `packages/web/app/profile/page.tsx`
- Modify: `packages/web/app/page.tsx` (add a link to `/profile` when signed in)

**Interfaces:**
- Consumes: `ResumeCard`, `TextDocumentCard` (Task 4); `useProfileDocuments` (Task 3); `PER_DOCUMENT_CAP`, `WHOLE_PROFILE_CAP` (`@pinloop/shared`); `readSession` (Plan 2).
- Produces: the assembled `/profile` page, redirecting a signed-out visitor to `/sign-in`.

- [ ] **Step 1: Write `WholeProfileUsage`**

Not unit tested separately — it's a small, purely presentational aggregation over `useProfileDocuments`'s already-tested data, and it's exercised by Step 6's `next build` and the manual verification below.

```tsx
// packages/web/app/profile/whole-profile-usage.tsx
'use client';

import { WHOLE_PROFILE_CAP } from '@pinloop/shared';
import { useProfileDocuments } from '../../lib/profile-queries.ts';

export function WholeProfileUsage() {
  const { data } = useProfileDocuments();
  const textBytes = (data ?? [])
    .filter((document) => document.kind === 'text')
    .reduce((total, document) => total + document.bytes, 0);
  const overCap = textBytes > WHOLE_PROFILE_CAP;

  return (
    <p aria-live="polite">
      {textBytes.toLocaleString('en-US')} / {WHOLE_PROFILE_CAP.toLocaleString('en-US')} bytes of text
      documents stored{overCap ? ' — over the whole-profile limit' : ''}
    </p>
  );
}
```

- [ ] **Step 2: Write `ProfileEditor`**

```tsx
// packages/web/app/profile/profile-editor.tsx
'use client';

import { PER_DOCUMENT_CAP } from '@pinloop/shared';
import { ResumeCard } from './resume-card.tsx';
import { TextDocumentCard } from './text-document-card.tsx';
import { WholeProfileUsage } from './whole-profile-usage.tsx';

export function ProfileEditor() {
  return (
    <main>
      <h1>Profile</h1>
      <WholeProfileUsage />
      <ResumeCard />
      <TextDocumentCard name="constraints" label="Constraints" perDocumentCap={PER_DOCUMENT_CAP} />
      <TextDocumentCard name="background" label="Background" perDocumentCap={PER_DOCUMENT_CAP} />
      <TextDocumentCard name="preferences" label="Preferences" perDocumentCap={PER_DOCUMENT_CAP} />
      <TextDocumentCard name="judge-prompt" label="Judge prompt" perDocumentCap={PER_DOCUMENT_CAP} resettable />
      <TextDocumentCard
        name="quick-judge-prompt"
        label="Quick judge prompt"
        perDocumentCap={PER_DOCUMENT_CAP}
        resettable
      />
    </main>
  );
}
```

- [ ] **Step 3: Write the protected page**

Not unit tested, for the same reason as Plan 2's home page: this is an async Server Component calling `cookies()` from `next/headers`, which needs Next's request context and can't be invoked directly from a plain Vitest test. Covered by Step 6's `next build` and the manual verification below.

```tsx
// packages/web/app/profile/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession } from '../../lib/session.ts';
import { ProfileEditor } from './profile-editor.tsx';

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);
  if (!session.accessToken) redirect('/sign-in');

  return <ProfileEditor />;
}
```

- [ ] **Step 4: Link to it from the home page**

Modify `packages/web/app/page.tsx`'s signed-in branch:

```tsx
{signedIn ? (
  <p>
    Signed in{session.email ? ` as ${session.email}` : ''}. <SignOutButton />
  </p>
) : (
  <p>
    <Link href="/sign-in">Sign in</Link> to get started.
  </p>
)}
{signedIn && (
  <p>
    <Link href="/profile">Manage your profile</Link>
  </p>
)}
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: every test from Plans 1–3 passes.

- [ ] **Step 6: Build the whole app**

```bash
npm run build -w packages/web
```

Expected: exits 0.

- [ ] **Step 7: Manual verification (needs a real signed-in session from Plan 2's manual check)**

1. `npm run dev -w packages/web`, sign in as in Plan 2's verification.
2. Visit `http://localhost:3000/profile` directly while signed out (open a private window) — expect a redirect to `/sign-in`.
3. Signed in, visit `/profile`. Upload a real PDF resume — expect the page/character report to appear.
4. Try uploading a `.txt` file renamed to `.pdf`, and a file over 10MB — expect the client-side refusal message, with no network request going out for either (check the browser's network tab).
5. Type into "Background," confirm the byte counter updates and Save is disabled until the text changes.
6. Save it, reload the page — confirm the saved text is still there.
7. On "Judge prompt," confirm it shows "Using the default Pinloop ships" with no reset button, type something, save it, confirm the reset button now appears, click it, confirm it reverts to showing the default-in-use state again.

- [ ] **Step 8: Commit**

```bash
git add packages/web/app/profile packages/web/app/page.tsx
git commit -m "Assemble the profile page: resume upload, text documents, judge-prompt reset"
```

At this point: a signed-in person can manage their whole profile — including uploading and replacing their resume — entirely through the web app, reaching feature parity with `pinloop profile *`. Search, judge, and automation (routines/schedules/watches) remain as separate follow-on plans per the spec.

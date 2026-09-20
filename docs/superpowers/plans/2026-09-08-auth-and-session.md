# Auth & Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Superseded post-merge, kept as historical record.** Everything below describes what Tasks 1–5 actually built and is an accurate record of that work (all reviewed, tested, merged). But the short-code hand-off mechanism Task 3/4 built the UI around (`POST /auth/handoff/trade`, opening `talenttrove.ai/login` in a new tab) was tested by hand against the real backend after merge and doesn't work for a plain browser tab — the page closes with no code ever shown. It was replaced with a direct `POST /auth/send-code` / `POST /auth/verify-code` flow (no dependency on `talenttrove.ai/login` at all), confirmed working against the real server. See the spec's Auth & session model section for the current, correct design; the code for the old mechanism (`tradeHandoffCode`, `/api/auth/handoff`) is still in the tree, tested and correct against what it does, just not reachable from any UI anymore.

**Goal:** Let a person sign in to `packages/web` through the real hosted sign-in flow, keep them signed in across page loads via a server-side session, and sign out — reaching parity with `talenttrove login`/`talenttrove logout`, using the short-code hand-off mechanism the backend actually supports (see the spec's corrected Auth & session model section).

**Architecture:** A pure, framework-agnostic `lib/talenttrove-server.ts` ports the CLI's `callServer`/`callAsAccount` retry logic (dependency-injectable `fetch`, fully unit-testable). A pure `lib/session.ts` seals/unseals session data into a cookie value using `iron-session`'s low-level `sealData`/`unsealData` (not its Next-integrated `getIronSession`, which would force every test through Next's request-context machinery). Three route handlers under `app/api/auth/*` compose those two libraries using nothing but the Web-standard `Request`/`Response`, which keeps them directly callable — and testable — without a running Next server. The sign-in page opens the existing hosted sign-in flow in a new tab and trades the short code it shows for a pass.

**Tech Stack:** `iron-session` (cookie sealing only, not its Next-specific helpers), Vitest, `@testing-library/react` + `jsdom` for the two client components.

**Spec:** `docs/superpowers/specs/2026-09-08-web-app-migration-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-08-monorepo-restructuring.md` (needs `packages/web` scaffolded and buildable).

## Global Constraints

- No access token or refresh token is ever sent to the browser or readable by page JavaScript — the only thing that ever leaves the server is the sealed, httpOnly session cookie.
- The session cookie's contents are sealed (encrypted and signed) via `iron-session`, never stored as raw/plain JSON. `SESSION_SECRET` must be at least 32 characters; the app throws loudly at startup if it's missing or too short rather than running insecurely.
- On a `401`, renew the pass exactly once and retry the original call exactly once. If the retry also fails, surface that failure — never loop, never renew twice.
- Don't assume any backend endpoint beyond what's already confirmed by `src/shared/sign-in.ts`'s constants and what `talenttrove.ts` already calls: `POST /auth/handoff/trade` (trading a short code) and `POST /auth/refresh` (renewing a pass). In particular, there is no confirmed revoke/sign-out endpoint — sign-out only clears the local session cookie.
- `"type": "module"` and the monorepo's `strict`/`noUncheckedIndexedAccess` TypeScript conventions carry over (inherited from `packages/web/tsconfig.json`, written in the monorepo-restructuring plan).

---

### Task 1: `lib/talenttrove-server.ts` — the BFF proxy core

**Files:**
- Create: `packages/web/lib/talenttrove-server.ts`
- Create: `packages/web/lib/talenttrove-server.test.ts`
- Modify: `vitest.config.ts` (broaden the test-file include glob to cover `packages/web`)

**Interfaces:**
- Consumes: nothing from other tasks (first task).
- Produces: `TalentTroveServerError` (class, has `.status: number`), `type Pass = { accessToken: string; refreshToken?: string }`, `tradeHandoffCode(code: string, doFetch?: typeof fetch): Promise<Pass & { email?: string }>`, `refreshPass(refreshTokenValue: string, doFetch?: typeof fetch): Promise<Pass>`, `callAsAccount(pass: Pass, path: string, options?: { method?: string; body?: unknown }, doFetch?: typeof fetch): Promise<{ json: unknown; status: number; renewedPass?: Pass }>`. Every later task that needs to call the TalentTrove server imports from here.

- [ ] **Step 1: Broaden the Vitest include glob**

Plan 1's `vitest.config.ts` only looked under `packages/*/src/**` (which covers both `packages/shared` and `packages/cli`), but `packages/web` keeps its code directly under `lib/`/`app/` (matching the layout Plan 1 already scaffolded, not a `src/` wrapper) — so it needs its own pattern added, not a replacement that would silently drop `packages/cli` from test discovery:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/web/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
  },
});
```

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/web/lib/talenttrove-server.test.ts
import { describe, expect, it, vi } from 'vitest';
import { TalentTroveServerError, callAsAccount, refreshPass, tradeHandoffCode } from './talenttrove-server.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('tradeHandoffCode', () => {
  it('returns the pass the server hands back for a valid code', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'a1', refresh_token: 'r1', email: 'a@example.com' }));
    const pass = await tradeHandoffCode('123456', doFetch as unknown as typeof fetch);
    expect(pass).toEqual({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/handoff/trade'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when the server accepts the code but sends back no pass', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    await expect(tradeHandoffCode('123456', doFetch as unknown as typeof fetch)).rejects.toThrow(
      TalentTroveServerError,
    );
  });
});

describe('callAsAccount', () => {
  it('makes the call with the access token and returns the answer', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const result = await callAsAccount({ accessToken: 'a1' }, '/profile', {}, doFetch as unknown as typeof fetch);
    expect(result.json).toEqual({ ok: true });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/profile'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer a1' }) }),
    );
  });

  it('renews the pass once and retries after a 401, then succeeds', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'a2', refresh_token: 'r2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await callAsAccount(
      { accessToken: 'a1', refreshToken: 'r1' },
      '/profile',
      {},
      doFetch as unknown as typeof fetch,
    );
    expect(result.json).toEqual({ ok: true });
    expect(result.renewedPass).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it('throws without retrying when there is no refresh token to renew with', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'expired' }, 401));
    await expect(
      callAsAccount({ accessToken: 'a1' }, '/profile', {}, doFetch as unknown as typeof fetch),
    ).rejects.toThrow(TalentTroveServerError);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('throws when the renewed retry also fails, without retrying a third time', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'a2' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'still no' }, 401));
    await expect(
      callAsAccount({ accessToken: 'a1', refreshToken: 'r1' }, '/profile', {}, doFetch as unknown as typeof fetch),
    ).rejects.toThrow(TalentTroveServerError);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });
});

describe('refreshPass', () => {
  it('throws when the server refuses the renewal', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad refresh token' }, 401));
    await expect(refreshPass('r1', doFetch as unknown as typeof fetch)).rejects.toThrow(TalentTroveServerError);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run packages/web/lib/talenttrove-server.test.ts
```

Expected: FAIL — `./talenttrove-server.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// packages/web/lib/talenttrove-server.ts
const SERVER_URL = process.env.TALENTTROVE_SERVER_URL ?? 'https://api.talenttrove.ai';

export class TalentTroveServerError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type Pass = {
  accessToken: string;
  refreshToken?: string;
};

type CallOptions = {
  method?: string;
  body?: unknown;
  token?: string;
};

async function rawCall(
  path: string,
  options: CallOptions,
  doFetch: typeof fetch,
): Promise<{ json: unknown; status: number }> {
  const headers: Record<string, string> = { 'talenttrove-web-version': '0.0.0' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await doFetch(`${SERVER_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (response.status >= 400) {
    const asRecord = json as { error?: string; message?: string } | undefined;
    const message = asRecord?.error ?? asRecord?.message ?? text ?? `HTTP ${response.status}`;
    throw new TalentTroveServerError(message, response.status);
  }

  return { json, status: response.status };
}

export async function tradeHandoffCode(
  code: string,
  doFetch: typeof fetch = fetch,
): Promise<Pass & { email?: string }> {
  const { json } = await rawCall('/auth/handoff/trade', { method: 'POST', body: { code } }, doFetch);
  const asRecord = json as { access_token?: string; refresh_token?: string; email?: string } | undefined;
  if (typeof asRecord?.access_token !== 'string' || asRecord.access_token === '') {
    throw new TalentTroveServerError('that code was taken but carried no pass', 400);
  }
  return {
    accessToken: asRecord.access_token,
    refreshToken: asRecord.refresh_token,
    email: asRecord.email,
  };
}

export async function refreshPass(refreshTokenValue: string, doFetch: typeof fetch = fetch): Promise<Pass> {
  const { json } = await rawCall(
    '/auth/refresh',
    { method: 'POST', body: { refresh_token: refreshTokenValue } },
    doFetch,
  );
  const asRecord = json as { access_token?: string; refresh_token?: string } | undefined;
  if (typeof asRecord?.access_token !== 'string' || asRecord.access_token === '') {
    throw new TalentTroveServerError('the renewal did not return a pass', 401);
  }
  return {
    accessToken: asRecord.access_token,
    refreshToken: asRecord.refresh_token ?? refreshTokenValue,
  };
}

export async function callAsAccount(
  pass: Pass,
  path: string,
  options: { method?: string; body?: unknown } = {},
  doFetch: typeof fetch = fetch,
): Promise<{ json: unknown; status: number; renewedPass?: Pass }> {
  try {
    return await rawCall(path, { ...options, token: pass.accessToken }, doFetch);
  } catch (error) {
    const wasExpired = error instanceof TalentTroveServerError && error.status === 401;
    if (!wasExpired || !pass.refreshToken) throw error;
    const renewedPass = await refreshPass(pass.refreshToken, doFetch);
    const result = await rawCall(path, { ...options, token: renewedPass.accessToken }, doFetch);
    return { ...result, renewedPass };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run packages/web/lib/talenttrove-server.test.ts
```

Expected: 7 passed, 0 failed (2 `tradeHandoffCode` + 4 `callAsAccount` + 1 `refreshPass` — the original "6 passed" here was a miscount of Step 2's own test file).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts packages/web/lib
git commit -m "Add the BFF proxy core: callAsAccount with one-shot refresh-and-retry"
```

---

### Task 2: `lib/session.ts` — sealed session cookies

**Files:**
- Create: `packages/web/lib/session.ts`
- Create: `packages/web/lib/session.test.ts`
- Modify: `packages/web/package.json` (add `iron-session` dependency)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `SESSION_COOKIE_NAME` (string constant), `type SessionData = { accessToken?: string; refreshToken?: string; email?: string }`, `readSession(cookieHeader: string | null): Promise<SessionData>`, `sealSession(data: SessionData): Promise<string>`, `sessionCookieHeader(sealedValue: string): string`, `clearedSessionCookieHeader(): string`. Task 3's route handlers, and later the home page, import all six.

- [ ] **Step 1: Add `iron-session`**

```json
// packages/web/package.json — add to "dependencies"
"iron-session": "^8.0.4"
```

```bash
npm install
```

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/web/lib/session.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  clearedSessionCookieHeader,
  readSession,
  sealSession,
  sessionCookieHeader,
} from './session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe('sealSession / readSession', () => {
  it('round-trips session data through a cookie header', async () => {
    const sealed = await sealSession({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
    const session = await readSession(`${SESSION_COOKIE_NAME}=${sealed}`);
    expect(session).toEqual({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
  });

  it('returns an empty session when there is no cookie at all', async () => {
    expect(await readSession(null)).toEqual({});
  });

  it('returns an empty session for a tampered cookie value, rather than throwing', async () => {
    // Corrupting a byte WITHIN the sealed string, not appending after it: iron-session's
    // sealed format tolerates (and silently ignores) trailing bytes appended past the end
    // of a valid seal — appending garbage there still unseals to the original data, verified
    // directly against the real library during this plan's execution. Flipping a byte inside
    // the seal's fixed-length prefix (password id + salt, always present regardless of
    // payload size) is what actually invalidates the HMAC and proves tampering is caught.
    const sealed = await sealSession({ accessToken: 'a1' });
    const tampered = `${sealed.slice(0, 20)}X${sealed.slice(21)}`;
    expect(await readSession(`${SESSION_COOKIE_NAME}=${tampered}`)).toEqual({});
  });

  it('reads the right cookie out of a header carrying several', async () => {
    const sealed = await sealSession({ accessToken: 'a1' });
    const header = `other=1; ${SESSION_COOKIE_NAME}=${sealed}; another=2`;
    expect(await readSession(header)).toEqual({ accessToken: 'a1' });
  });
});

describe('sessionCookieHeader / clearedSessionCookieHeader', () => {
  it('sets the cookie httpOnly, secure, and scoped to the whole site', () => {
    const header = sessionCookieHeader('sealed-value');
    expect(header).toContain(`${SESSION_COOKIE_NAME}=sealed-value`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(clearedSessionCookieHeader()).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run packages/web/lib/session.test.ts
```

Expected: FAIL — `./session.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// packages/web/lib/session.ts
import { sealData, unsealData } from 'iron-session';

export const SESSION_COOKIE_NAME = 'talenttrove_session';

export type SessionData = {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
};

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a string of at least 32 characters');
  }
  return secret;
}

function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export async function readSession(cookieHeader: string | null): Promise<SessionData> {
  const raw = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!raw) return {};
  try {
    return await unsealData<SessionData>(raw, { password: sessionSecret() });
  } catch {
    // A tampered or stale cookie is treated as no session at all, never as an
    // error — the person is simply signed out and can sign in again.
    return {};
  }
}

export async function sealSession(data: SessionData): Promise<string> {
  return sealData(data, { password: sessionSecret() });
}

// 30 days: how long a person stays signed in before they need to go through
// the sign-in flow again from scratch. Independent of the access/refresh
// token lifetimes — callAsAccount already renews the access token as needed
// within this window.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function sessionCookieHeader(sealedValue: string): string {
  return (
    `${SESSION_COOKIE_NAME}=${sealedValue}; HttpOnly; Secure; SameSite=Lax; ` +
    `Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run packages/web/lib/session.test.ts
```

Expected: 6 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/lib/session.ts packages/web/lib/session.test.ts
git commit -m "Add sealed session cookie helpers"
```

---

### Task 3: Auth route handlers

**Files:**
- Create: `packages/web/app/api/auth/handoff/route.ts`
- Create: `packages/web/app/api/auth/handoff/route.test.ts`
- Create: `packages/web/app/api/auth/session/route.ts`
- Create: `packages/web/app/api/auth/session/route.test.ts`
- Create: `packages/web/app/api/auth/logout/route.ts`
- Create: `packages/web/app/api/auth/logout/route.test.ts`

**Interfaces:**
- Consumes: `TalentTroveServerError`, `tradeHandoffCode` (Task 1); `readSession`, `sealSession`, `sessionCookieHeader`, `clearedSessionCookieHeader`, `SESSION_COOKIE_NAME` (Task 2).
- Produces: three working endpoints — `POST /api/auth/handoff` (trades a code for a session), `GET /api/auth/session` (reports sign-in status), `POST /api/auth/logout` (clears the session) — that Task 4's UI calls.

- [ ] **Step 1: Write the failing tests for `/api/auth/handoff`**

```typescript
// packages/web/app/api/auth/handoff/route.test.ts
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
```

- [ ] **Step 2: Run it, verify it fails, then write `route.ts`**

```bash
npx vitest run packages/web/app/api/auth/handoff/route.test.ts
```

Expected: FAIL — the route file doesn't exist yet.

```typescript
// packages/web/app/api/auth/handoff/route.ts
import { TalentTroveServerError, tradeHandoffCode } from '../../../../lib/talenttrove-server.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (code === '') {
    return Response.json({ error: 'paste the code the sign-in page showed you' }, { status: 400 });
  }

  try {
    const pass = await tradeHandoffCode(code);
    const sealed = await sealSession({
      accessToken: pass.accessToken,
      refreshToken: pass.refreshToken,
      email: pass.email,
    });
    const response = Response.json({ email: pass.email ?? null });
    response.headers.append('Set-Cookie', sessionCookieHeader(sealed));
    return response;
  } catch (error) {
    const message = error instanceof TalentTroveServerError ? error.message : 'could not sign in';
    const status = error instanceof TalentTroveServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
```

Run again — expected: 3 passed, 0 failed.

- [ ] **Step 3: Write, run-to-fail, then implement `/api/auth/session`**

```typescript
// packages/web/app/api/auth/session/route.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe('GET /api/auth/session', () => {
  it('reports signed out when there is no session cookie', async () => {
    const response = await GET(new Request('http://localhost/api/auth/session'));
    expect(await response.json()).toEqual({ signedIn: false });
  });

  it('reports signed in with the email when a valid session cookie is present', async () => {
    const sealed = await sealSession({ accessToken: 'a1', email: 'a@example.com' });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;
    const request = new Request('http://localhost/api/auth/session', { headers: { cookie } });
    const response = await GET(request);
    expect(await response.json()).toEqual({ signedIn: true, email: 'a@example.com' });
  });
});
```

```bash
npx vitest run packages/web/app/api/auth/session/route.test.ts
```

Expected: FAIL.

```typescript
// packages/web/app/api/auth/session/route.ts
import { readSession } from '../../../../lib/session.ts';

export async function GET(request: Request): Promise<Response> {
  const session = await readSession(request.headers.get('cookie'));
  if (!session.accessToken) return Response.json({ signedIn: false });
  return Response.json({ signedIn: true, email: session.email ?? null });
}
```

Run again — expected: 2 passed, 0 failed.

- [ ] **Step 4: Write, run-to-fail, then implement `/api/auth/logout`**

```typescript
// packages/web/app/api/auth/logout/route.test.ts
import { describe, expect, it } from 'vitest';
import { POST } from './route.ts';

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const response = await POST();
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
```

```bash
npx vitest run packages/web/app/api/auth/logout/route.test.ts
```

Expected: FAIL.

```typescript
// packages/web/app/api/auth/logout/route.ts
import { clearedSessionCookieHeader } from '../../../../lib/session.ts';

export async function POST(): Promise<Response> {
  const response = Response.json({ signedIn: false });
  response.headers.append('Set-Cookie', clearedSessionCookieHeader());
  return response;
}
```

Run again — expected: 1 passed, 0 failed.

(No confirmed server-side revoke endpoint exists per this plan's Global Constraints, so logout only clears the local cookie — the CLI's own `talenttrove logout` does exactly the same thing to `credentials.json`, deleting the local file without calling the server.)

- [ ] **Step 5: Run the whole auth test suite together and commit**

```bash
npx vitest run packages/web/app/api/auth
```

Expected: 6 passed, 0 failed (across all three route test files).

```bash
git add packages/web/app/api/auth
git commit -m "Add auth route handlers: handoff, session, logout"
```

---

### Task 4: Sign-in page and session-aware home page

**Files:**
- Create: `packages/web/app/sign-in/page.tsx`
- Create: `packages/web/app/sign-in/page.test.tsx`
- Create: `packages/web/app/sign-out-button.tsx`
- Create: `packages/web/app/sign-out-button.test.tsx`
- Modify: `packages/web/app/page.tsx` (replaces Plan 1's placeholder that only proved `@talenttrove/shared` was importable)
- Modify: `packages/web/package.json` (add `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` as devDependencies)

**Interfaces:**
- Consumes: `readSession` (Task 2, used by the Server Component home page only — not unit tested, see note below).
- Produces: a working `/sign-in` page and a `SignOutButton` client component the home page renders.

- [ ] **Step 1: Add the testing libraries**

```json
// packages/web/package.json — add to "devDependencies"
"jsdom": "^25.0.1",
"@testing-library/react": "^16.0.1",
"@testing-library/jest-dom": "^6.6.3"
```

```bash
npm install
```

- [ ] **Step 2: Write the failing test for `SignOutButton`**

```tsx
// packages/web/app/sign-out-button.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignOutButton } from './sign-out-button.tsx';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe('SignOutButton', () => {
  it('calls the logout endpoint and returns to the home page', async () => {
    const doFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ signedIn: false })));
    vi.stubGlobal('fetch', doFetch);

    render(<SignOutButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(doFetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' }));
    expect(push).toHaveBeenCalledWith('/');
    expect(refresh).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it, verify it fails, then write `sign-out-button.tsx`**

```bash
npx vitest run packages/web/app/sign-out-button.test.tsx
```

Expected: FAIL — the component doesn't exist yet.

```tsx
// packages/web/app/sign-out-button.tsx
'use client';

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();

  async function handleClick(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return <button onClick={handleClick}>Sign out</button>;
}
```

Run again — expected: 1 passed, 0 failed.

- [ ] **Step 4: Write the failing tests for `SignInPage`**

```tsx
// packages/web/app/sign-in/page.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignInPage from './page.tsx';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe('SignInPage', () => {
  it('disables the submit button until a code is typed', () => {
    render(<SignInPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('shows the server error when the code is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'that code has expired' }), { status: 400 })),
    );
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('that code has expired');
    expect(push).not.toHaveBeenCalled();
  });

  it('navigates home once the code is accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ email: 'a@example.com' }), { status: 200 })),
    );
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(refresh).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run it, verify it fails, then write `page.tsx`**

```bash
npx vitest run packages/web/app/sign-in/page.test.tsx
```

Expected: FAIL — the page doesn't exist yet.

```tsx
// packages/web/app/sign-in/page.tsx
'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

const SIGN_IN_URL = 'https://talenttrove.ai/login';

export default function SignInPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch('/api/auth/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = (await response.json()) as { error?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? 'could not sign in');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p>
        <a href={SIGN_IN_URL} target="_blank" rel="noopener noreferrer">
          Open the sign-in page
        </a>{' '}
        in a new tab, sign in with Google, GitHub, or an emailed code, then paste the code it
        shows you below.
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="code">Code</label>
        <input id="code" value={code} onChange={(event) => setCode(event.target.value)} disabled={submitting} />
        <button type="submit" disabled={submitting || code.trim() === ''}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
```

Run again — expected: 3 passed, 0 failed.

- [ ] **Step 6: Update the home page to reflect session state**

This isn't unit tested here: it's an async Server Component that calls `cookies()` from `next/headers`, which requires Next's request-context (`AsyncLocalStorage`) to be active and throws when invoked directly outside a running Next server — there's no meaningful way to call it from a plain Vitest test the way the client components above were called. It's covered instead by Task 5's manual end-to-end verification, and (out of scope for this plan) by e2e tooling like Playwright later, if this project adds any.

```tsx
// packages/web/app/page.tsx
import Link from 'next/link';
import { cookies } from 'next/headers';
import { readSession } from '../lib/session.ts';
import { SignOutButton } from './sign-out-button.tsx';

export default async function HomePage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);
  const signedIn = Boolean(session.accessToken);

  return (
    <main>
      <h1>TalentTrove</h1>
      {signedIn ? (
        <p>
          Signed in{session.email ? ` as ${session.email}` : ''}. <SignOutButton />
        </p>
      ) : (
        <p>
          <Link href="/sign-in">Sign in</Link> to get started.
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Build the whole app to catch anything the unit tests can't**

```bash
npm run build -w packages/web
```

Expected: exits 0. `next build` type-checks and prerenders every route, including the Server Component home page the unit tests skip.

- [ ] **Step 8: Commit**

```bash
git add packages/web/app packages/web/package.json
git commit -m "Add the sign-in page and a session-aware home page"
```

---

### Task 5: Environment configuration and manual end-to-end verification

**Files:**
- Create: `packages/web/.env.example`
- Modify: `.gitignore` (ignore local env files)

**Interfaces:**
- Consumes: `TALENTTROVE_SERVER_URL` (read by `lib/talenttrove-server.ts`) and `SESSION_SECRET` (read by `lib/session.ts`) — both already implemented, this task only documents and verifies them.
- Produces: nothing new in code — this task is verification and documentation.

- [ ] **Step 1: Write `packages/web/.env.example`**

```
TALENTTROVE_SERVER_URL=https://api.talenttrove.ai
SESSION_SECRET=replace-with-a-random-string-at-least-32-characters-long
```

- [ ] **Step 2: Ignore local env files**

Add to `.gitignore`:

```
.env
.env.local
.env*.local
```

- [ ] **Step 3: Manual verification (cannot be scripted — needs a real TalentTrove account)**

This step can't be automated: it requires a real account on the real hosted sign-in page, which is outside this repo and outside CI's reach. Run it by hand once:

1. Copy `packages/web/.env.example` to `packages/web/.env.local`, and fill in a real random 32+ character `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` works).
2. `npm run dev -w packages/web`.
3. Visit `http://localhost:3000` — expect "Sign in to get started."
4. Click "Sign in". In the new tab, complete sign-in against the real `talenttrove.ai/login` with any of Google, GitHub, or an emailed code.
5. Note the short code the callback page shows (no loopback listener is running, so it falls back to the code — this is expected, see the spec's Auth & session model section).
6. Switch back to the original tab, paste the code, submit.
7. Expect a redirect to `/` showing "Signed in as `<your email>`."
8. Reload the page. Expect it to still say "Signed in" — this proves the session cookie persisted and is being read correctly by the Server Component.
9. Click "Sign out". Expect it to return to "Sign in to get started."

- [ ] **Step 4: Commit**

```bash
git add packages/web/.env.example .gitignore
git commit -m "Document required environment variables for packages/web"
```

At this point: a person can sign in through the real hosted flow, stay signed in across reloads via a sealed httpOnly cookie, and sign out — with `lib/talenttrove-server.ts`'s `callAsAccount` ready for Plan 3 (profile/CV upload) to build its first real authenticated feature on.

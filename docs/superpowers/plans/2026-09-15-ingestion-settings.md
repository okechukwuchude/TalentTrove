# In-App Ingestion Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let postings-ingestion config (search queries, countries, API keys, company board lists) be set from a new `/settings` page in the running app, instead of only via `.env`/deployment env vars.

**Architecture:** A single generic `app_settings` key-value table backs a small `settings-db.ts` module (`getSetting`/`getSecretSetting`/`setSetting`/`setSecretSetting`/`clearSetting`), with secrets encrypted at rest via a new `settings-crypto.ts` (AES-256-GCM, key derived from `SESSION_SECRET`). Each of the five ingestion adapters (`jsearch`, `adzuna`, `greenhouse`, `lever`, `ashby`) changes its config reads from `process.env.X` to `(await getSetting('x')) ?? process.env.X` — DB overrides env, env stays the fallback. A new `/api/settings` route (GET/PUT) and `/settings` page, gated the same way every other page is (`requireSession`, any signed-in user — this app has no roles concept), expose it in the UI.

**Tech Stack:** Next.js App Router, Drizzle ORM (Postgres), TanStack Query, Vitest, Node's built-in `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-09-15-ingestion-settings-design.md`

## Global Constraints

- **DB overrides env; env is never removed.** Every adapter read becomes `(await getSetting(key)) ?? process.env.ENV_VAR`. An empty string saved via the API clears the DB row (reverts to the env fallback) rather than storing `''`.
- **Settings table:** `app_settings(key text primary key, value text not null, updated_at timestamptz not null default now())`. One row per key; no row means "use the env var."
- **Ten setting keys, exactly these:** `jsearch_api_key` (secret), `jsearch_queries`, `jsearch_country` (new — no adapter behavior for this exists today), `adzuna_app_id` (secret), `adzuna_app_key` (secret), `adzuna_countries`, `adzuna_queries`, `greenhouse_companies`, `lever_companies`, `ashby_companies`.
- **Secrets are encrypted at rest**, AES-256-GCM, key derived from `SESSION_SECRET` via `scryptSync` with a fixed purpose-salt `'talenttrove-settings-v1'` (no new required env var — every deployment already has `SESSION_SECRET`). Stored as `base64(iv):base64(authTag):base64(ciphertext)`.
- **Secrets never round-trip to the client.** The settings API returns only `isSet: boolean` for secret keys, never their value — the same principle as a password field.
- **Access:** any signed-in user (`requireSession`), matching every other page in this app. No admin/role concept is introduced.
- **DB-gated tests follow this repo's existing convention exactly:** `describe.skipIf(!testDatabaseUrl)(...)`, `runMigrations(testDatabaseUrl)` in `beforeAll`, cleanup via raw `sql` deletes in `afterEach`, `sql.end()` in `afterAll`. These tests only run with `TEST_DATABASE_URL` set; without it they're skipped (not failed) — that's expected and matches every other DB-backed test in this repo (e.g. `lib/routines-db.test.ts`).
- All new/changed source files are TypeScript with `.ts`/`.tsx` extensions in relative imports, matching every existing file in `packages/web`.

---

### Task 1: `app_settings` table

**Files:**
- Modify: `packages/web/db/schema.ts`
- Modify: `packages/web/db/schema.test.ts`
- Create: `packages/web/db/migrations/0008_<generated>.sql` (via `drizzle-kit generate`, name chosen by the tool)
- Create: `packages/web/db/migrations/meta/0008_snapshot.json` (via `drizzle-kit generate`)
- Modify: `packages/web/db/migrations/meta/_journal.json` (via `drizzle-kit generate`)

**Interfaces:**
- Produces: `export const appSettings = pgTable('app_settings', { key: text('key').primaryKey(), value: text('value').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() })` — every later task's DB access goes through this.

- [ ] **Step 1: Add the `appSettings` table to the schema**

Append to the end of `packages/web/db/schema.ts` (after the `routines` export):

```ts
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // plaintext for non-secret keys; AES-256-GCM ciphertext for secret keys (lib/settings-crypto.ts)
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Add the (currently failing) schema test**

Append this `it` block inside the existing `describe.skipIf(!testDatabaseUrl)('schema migrations', ...)` block in `packages/web/db/schema.test.ts`, right after the `'creates the routines table'` test:

```ts
  it('creates the app_settings table', async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'app_settings'
    `;
    expect(tables).toHaveLength(1);

    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings'
      order by column_name
    `;
    expect(columns.map((c) => c.column_name).sort()).toEqual(['key', 'updated_at', 'value']);
  });
```

- [ ] **Step 3: Run the test to confirm it fails (skipped if no local Postgres)**

Run: `TEST_DATABASE_URL=<your-test-db-url> npx vitest run packages/web/db/schema.test.ts`
Expected: FAIL — `app_settings` doesn't exist yet (no migration for it). If you don't have `TEST_DATABASE_URL` set to a real Postgres locally, skip this step (the test suite reports the whole block as skipped, not failed); the migration and test will still be verified wherever this repo's DB-backed tests normally run.

- [ ] **Step 4: Generate the migration**

Run (from `packages/web/`): `npx drizzle-kit generate`

This reads the schema change and writes a new numbered file under `db/migrations/` plus matching `meta/` entries. Open the generated `.sql` file and confirm it matches:

```sql
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

- [ ] **Step 5: Run the test to confirm it passes (skipped if no local Postgres)**

Run: `TEST_DATABASE_URL=<your-test-db-url> npx vitest run packages/web/db/schema.test.ts`
Expected: PASS (or skipped, per Step 3's note).

- [ ] **Step 6: Commit**

```bash
git add packages/web/db/schema.ts packages/web/db/schema.test.ts packages/web/db/migrations
git commit -m "db: add app_settings table for in-app ingestion config"
```

---

### Task 2: `settings-crypto.ts` — encrypt/decrypt secrets at rest

**Files:**
- Create: `packages/web/lib/settings-crypto.ts`
- Test: `packages/web/lib/settings-crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plaintext: string): string`, `decryptSecret(stored: string): string` — Task 3's `settings-db.ts` calls both.

- [ ] **Step 1: Write the failing test**

Create `packages/web/lib/settings-crypto.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './settings-crypto.ts';

describe('settings-crypto', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it('round-trips a plaintext value', () => {
    const stored = encryptSecret('super-secret-key');
    expect(decryptSecret(stored)).toBe('super-secret-key');
  });

  it('produces different ciphertext for the same plaintext on repeated calls', () => {
    const first = encryptSecret('same-value');
    const second = encryptSecret('same-value');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe('same-value');
    expect(decryptSecret(second)).toBe('same-value');
  });

  it('throws when decrypting a tampered ciphertext', () => {
    const stored = encryptSecret('super-secret-key');
    const [iv, authTag] = stored.split(':');
    expect(() => decryptSecret(`${iv}:${authTag}:AAAAAAAAAAAAAAAA`)).toThrow();
  });

  it('throws when SESSION_SECRET is not set', () => {
    delete process.env.SESSION_SECRET;
    expect(() => encryptSecret('x')).toThrow(/SESSION_SECRET/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/lib/settings-crypto.test.ts`
Expected: FAIL with "Cannot find module './settings-crypto.ts'" (or similar — the module doesn't exist yet).

- [ ] **Step 3: Implement `settings-crypto.ts`**

Create `packages/web/lib/settings-crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Purpose-specific, not secret — it only needs to keep this derived key from
// colliding with some other scryptSync(SESSION_SECRET, ...) use elsewhere in
// this app. SESSION_SECRET itself, unique per deployment and already
// required to be high-entropy, is the actual secret input.
const SALT = 'talenttrove-settings-v1';

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET must be set to encrypt/decrypt settings');
  return scryptSync(secret, SALT, 32);
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const key = deriveKey();
  const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error('malformed encrypted setting');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/settings-crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/settings-crypto.ts packages/web/lib/settings-crypto.test.ts
git commit -m "web: add AES-256-GCM helper for encrypting settings at rest"
```

---

### Task 3: `settings-db.ts` — read/write settings, DB-backed

**Files:**
- Create: `packages/web/lib/settings-db.ts`
- Test: `packages/web/lib/settings-db.test.ts`

**Interfaces:**
- Consumes: `appSettings` table (Task 1); `encryptSecret`/`decryptSecret` (Task 2); `getDb()` from `./db.ts`.
- Produces: `getSetting(key: string): Promise<string | null>`, `getSecretSetting(key: string): Promise<string | null>`, `setSetting(key: string, value: string): Promise<void>`, `setSecretSetting(key: string, value: string): Promise<void>`, `clearSetting(key: string): Promise<void>` — every adapter (Tasks 4–8) and the settings API route (Task 9) call these.

- [ ] **Step 1: Write the failing test**

Create `packages/web/lib/settings-db.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('settings-db', () => {
  let settingsDb: typeof import('./settings-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    settingsDb = await import('./settings-db.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from app_settings`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('returns null for a key that was never set', async () => {
    expect(await settingsDb.getSetting('jsearch_queries')).toBeNull();
    expect(await settingsDb.getSecretSetting('jsearch_api_key')).toBeNull();
  });

  it('round-trips a plain setting', async () => {
    await settingsDb.setSetting('jsearch_queries', 'staff engineer,backend engineer');
    expect(await settingsDb.getSetting('jsearch_queries')).toBe('staff engineer,backend engineer');
  });

  it('round-trips a secret setting, storing it encrypted', async () => {
    await settingsDb.setSecretSetting('jsearch_api_key', 'super-secret-key');
    expect(await settingsDb.getSecretSetting('jsearch_api_key')).toBe('super-secret-key');

    const [row] = await sql`select value from app_settings where key = 'jsearch_api_key'`;
    expect(row!['value']).not.toBe('super-secret-key');
  });

  it('setSetting overwrites an existing value for the same key', async () => {
    await settingsDb.setSetting('jsearch_queries', 'first');
    await settingsDb.setSetting('jsearch_queries', 'second');
    expect(await settingsDb.getSetting('jsearch_queries')).toBe('second');
  });

  it('clearSetting removes the row', async () => {
    await settingsDb.setSetting('jsearch_queries', 'staff engineer');
    await settingsDb.clearSetting('jsearch_queries');
    expect(await settingsDb.getSetting('jsearch_queries')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (skipped if no local Postgres)**

Run: `TEST_DATABASE_URL=<your-test-db-url> npx vitest run packages/web/lib/settings-db.test.ts`
Expected: FAIL — `./settings-db.ts` doesn't exist yet. If you don't have a local `TEST_DATABASE_URL`, this step is skipped (see Task 1 Step 3's note); proceed to implement anyway.

- [ ] **Step 3: Implement `settings-db.ts`**

Create `packages/web/lib/settings-db.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDb } from './db.ts';
import { appSettings } from '../db/schema.ts';
import { decryptSecret, encryptSecret } from './settings-crypto.ts';

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function getSecretSetting(key: string): Promise<string | null> {
  const raw = await getSetting(key);
  return raw === null ? null : decryptSecret(raw);
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb()
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function setSecretSetting(key: string, value: string): Promise<void> {
  await setSetting(key, encryptSecret(value));
}

export async function clearSetting(key: string): Promise<void> {
  await getDb().delete(appSettings).where(eq(appSettings.key, key));
}
```

- [ ] **Step 4: Run the test to verify it passes (skipped if no local Postgres)**

Run: `TEST_DATABASE_URL=<your-test-db-url> npx vitest run packages/web/lib/settings-db.test.ts`
Expected: PASS (5 tests), or skipped per Step 2's note.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/settings-db.ts packages/web/lib/settings-db.test.ts
git commit -m "web: add settings-db read/write helpers for app_settings"
```

---

### Task 4: `jsearch.ts` reads settings from the DB, gains a country param

**Files:**
- Modify: `packages/web/lib/ingestion/jsearch.ts`
- Modify: `packages/web/lib/ingestion/jsearch.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `getSecretSetting` from `../settings-db.ts` (Task 3).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/web/lib/ingestion/jsearch.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsearchAdapter } from './jsearch.ts';
import * as settingsDb from '../settings-db.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

describe('jsearchAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    delete process.env.JSEARCH_API_KEY;
    delete process.env.JSEARCH_QUERIES;
    delete process.env.JSEARCH_COUNTRY;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await jsearchAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a JSearch response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    process.env.JSEARCH_QUERIES = 'staff engineer';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            job_title: 'Staff Software Engineer',
            employer_name: 'Acme Corp',
            job_city: 'Remote',
            job_country: 'US',
            job_is_remote: true,
            job_employment_type: 'FULLTIME',
            job_posted_at_datetime_utc: '2026-09-01T00:00:00.000Z',
            job_apply_link: 'https://example.com/jobs/jsearch-1',
            job_description: 'We need a strong backend engineer with 5+ years experience.',
          },
          { job_title: 'Missing company and link' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await jsearchAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Staff Software Engineer',
        company: 'Acme Corp',
        locations: ['Remote, US'],
        country: 'United States',
        workplace: 'remote',
        employment: 'full-time',
        description: 'We need a strong backend engineer with 5+ years experience.',
        postedAt: new Date('2026-09-01T00:00:00.000Z'),
        url: 'https://example.com/jobs/jsearch-1',
        source: 'jsearch',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('query=staff%20engineer'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'test-key' }) }),
    );
  });

  it('appends a country param to the request URL when a country is configured, omits it otherwise', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    process.env.JSEARCH_QUERIES = 'staff engineer';
    process.env.JSEARCH_COUNTRY = 'us';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('&country=us'), expect.anything());
  });

  it('prefers DB-stored settings over env vars', async () => {
    process.env.JSEARCH_API_KEY = 'env-key';
    process.env.JSEARCH_QUERIES = 'env query';
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) =>
      key === 'jsearch_api_key' ? 'db-key' : null,
    );
    vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
      key === 'jsearch_queries' ? 'db query' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('query=db%20query'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'db-key' }) }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run packages/web/lib/ingestion/jsearch.test.ts`
Expected: the two new tests (country param, DB-override) FAIL — `jsearch.ts` doesn't read settings or a country yet. The two pre-existing tests should still PASS unchanged (the mock defaults to `null`, so behavior falls through to env vars exactly as today).

- [ ] **Step 3: Update `jsearch.ts`**

Modify `packages/web/lib/ingestion/jsearch.ts`. Change the import line and `fetchPostings` function:

```ts
import type { IngestionAdapter, RawPosting } from './types.ts';
import { normalizeCountry } from './shared.ts';
import { getSecretSetting, getSetting } from '../settings-db.ts';
```

```ts
async function fetchPostings(): Promise<RawPosting[]> {
  const apiKey = (await getSecretSetting('jsearch_api_key')) ?? process.env.JSEARCH_API_KEY;
  const queriesRaw = (await getSetting('jsearch_queries')) ?? process.env.JSEARCH_QUERIES;
  const country = (await getSetting('jsearch_country')) ?? process.env.JSEARCH_COUNTRY;
  const queries = queriesRaw?.split(',').map((query) => query.trim()).filter(Boolean) ?? [];
  if (!apiKey || queries.length === 0) return [];

  const results: RawPosting[] = [];
  for (const query of queries) {
    const countryParam = country ? `&country=${encodeURIComponent(country)}` : '';
    const url = `${JSEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&num_pages=1${countryParam}`;
    const response = await fetch(url, {
      headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`jsearch: query "${query}" failed with ${response.status}`);
      continue;
    }
    const body = (await response.json()) as { data?: JSearchJob[] };
    for (const job of body.data ?? []) {
      const mapped = mapJob(job);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}
```

Everything else in the file (types, `mapEmployment`, `mapJob`, the `jsearchAdapter` export) is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/web/lib/ingestion/jsearch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/jsearch.ts packages/web/lib/ingestion/jsearch.test.ts
git commit -m "web: jsearch adapter reads settings from DB, adds country param"
```

---

### Task 5: `adzuna.ts` reads settings from the DB

**Files:**
- Modify: `packages/web/lib/ingestion/adzuna.ts`
- Modify: `packages/web/lib/ingestion/adzuna.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `getSecretSetting` from `../settings-db.ts` (Task 3).

- [ ] **Step 1: Write the failing test**

Replace the full contents of `packages/web/lib/ingestion/adzuna.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adzunaAdapter } from './adzuna.ts';
import * as settingsDb from '../settings-db.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

describe('adzunaAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
    delete process.env.ADZUNA_COUNTRIES;
    delete process.env.ADZUNA_QUERIES;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await adzunaAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an Adzuna response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    process.env.ADZUNA_COUNTRIES = 'us';
    process.env.ADZUNA_QUERIES = 'staff engineer';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Remote Backend Engineer',
            company: { display_name: 'Globex' },
            location: { display_name: 'Remote, US' },
            contract_time: 'full_time',
            created: '2026-09-02T00:00:00Z',
            redirect_url: 'https://example.com/jobs/adzuna-1',
            description: 'Full job description text.',
          },
          { title: 'Missing company and link' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await adzunaAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Remote Backend Engineer',
        company: 'Globex',
        locations: ['Remote, US'],
        country: 'United States',
        workplace: 'remote',
        employment: 'full-time',
        description: 'Full job description text.',
        postedAt: new Date('2026-09-02T00:00:00Z'),
        url: 'https://example.com/jobs/adzuna-1',
        source: 'adzuna',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/us/search/1'),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('prefers DB-stored settings over env vars', async () => {
    process.env.ADZUNA_APP_ID = 'env-id';
    process.env.ADZUNA_APP_KEY = 'env-key';
    process.env.ADZUNA_COUNTRIES = 'gb';
    process.env.ADZUNA_QUERIES = 'env query';
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) => {
      if (key === 'adzuna_app_id') return 'db-id';
      if (key === 'adzuna_app_key') return 'db-key';
      return null;
    });
    vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) => {
      if (key === 'adzuna_countries') return 'us';
      if (key === 'adzuna_queries') return 'db query';
      return null;
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await adzunaAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/us/search/1?app_id=db-id&app_key=db-key&what=db%20query'),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify the new one fails**

Run: `npx vitest run packages/web/lib/ingestion/adzuna.test.ts`
Expected: the DB-override test FAILS; the two pre-existing tests still PASS.

- [ ] **Step 3: Update `adzuna.ts`**

Modify `packages/web/lib/ingestion/adzuna.ts`. Change the import line and `fetchPostings` function:

```ts
import type { IngestionAdapter, RawPosting } from './types.ts';
import { normalizeCountry } from './shared.ts';
import { getSecretSetting, getSetting } from '../settings-db.ts';
```

```ts
async function fetchPostings(): Promise<RawPosting[]> {
  const appId = (await getSecretSetting('adzuna_app_id')) ?? process.env.ADZUNA_APP_ID;
  const appKey = (await getSecretSetting('adzuna_app_key')) ?? process.env.ADZUNA_APP_KEY;
  const countriesRaw = (await getSetting('adzuna_countries')) ?? process.env.ADZUNA_COUNTRIES;
  const queriesRaw = (await getSetting('adzuna_queries')) ?? process.env.ADZUNA_QUERIES;
  const countries = countriesRaw?.split(',').map((code) => code.trim().toLowerCase()).filter(Boolean) ?? [];
  const queries = queriesRaw?.split(',').map((query) => query.trim()).filter(Boolean) ?? [];
  if (!appId || !appKey || countries.length === 0 || queries.length === 0) return [];

  const results: RawPosting[] = [];
  for (const country of countries) {
    for (const query of queries) {
      const url = `${ADZUNA_ENDPOINT}/${country}/search/1?app_id=${appId}&app_key=${appKey}&what=${encodeURIComponent(query)}&content-type=application/json`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        console.error(`adzuna: ${country}/"${query}" failed with ${response.status}`);
        continue;
      }
      const body = (await response.json()) as { results?: AdzunaJob[] };
      for (const job of body.results ?? []) {
        const mapped = mapJob(job, country);
        if (mapped) results.push(mapped);
      }
    }
  }
  return results;
}
```

Everything else in the file is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/adzuna.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/adzuna.ts packages/web/lib/ingestion/adzuna.test.ts
git commit -m "web: adzuna adapter reads settings from DB"
```

---

### Task 6: `greenhouse.ts` reads settings from the DB

**Files:**
- Modify: `packages/web/lib/ingestion/greenhouse.ts`
- Modify: `packages/web/lib/ingestion/greenhouse.test.ts`

**Interfaces:**
- Consumes: `getSetting` from `../settings-db.ts` (Task 3).

- [ ] **Step 1: Write the failing test**

In `packages/web/lib/ingestion/greenhouse.test.ts`, add the mock setup and a new test. The file becomes:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { greenhouseAdapter } from './greenhouse.ts';
import * as settingsDb from '../settings-db.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

describe('greenhouseAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    delete process.env.GREENHOUSE_COMPANIES;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await greenhouseAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a Greenhouse jobs response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.GREENHOUSE_COMPANIES = 'acme:Acme Corp';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            title: 'Platform Engineer',
            absolute_url: 'https://example.com/jobs/greenhouse-1',
            updated_at: '2026-09-03T00:00:00Z',
            location: { name: 'Remote, United States' },
            content: 'Full job description text.',
          },
          { title: 'Missing url' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await greenhouseAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Platform Engineer',
        company: 'Acme Corp',
        locations: ['Remote, United States'],
        country: 'United States',
        workplace: 'remote',
        employment: null,
        description: 'Full job description text.',
        postedAt: new Date('2026-09-03T00:00:00Z'),
        url: 'https://example.com/jobs/greenhouse-1',
        source: 'greenhouse',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('leaves locations/country/workplace unset for a job with no location, rather than throwing', async () => {
    process.env.GREENHOUSE_COMPANIES = 'acme:Acme Corp';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [{ title: 'Remote-Friendly Role', absolute_url: 'https://example.com/jobs/greenhouse-2' }],
        }),
      }),
    );

    const rows = await greenhouseAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Remote-Friendly Role',
        company: 'Acme Corp',
        locations: undefined,
        country: null,
        workplace: null,
        employment: null,
        description: null,
        postedAt: null,
        url: 'https://example.com/jobs/greenhouse-2',
        source: 'greenhouse',
      },
    ]);
  });

  it('strips a "- Remote" suffix from the country segment instead of storing it as the country', async () => {
    process.env.GREENHOUSE_COMPANIES = 'acme:Acme Corp';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [
            {
              title: 'Support Engineer',
              absolute_url: 'https://example.com/jobs/greenhouse-3',
              location: { name: 'United States - Remote' },
            },
          ],
        }),
      }),
    );

    const [row] = await greenhouseAdapter.fetchPostings();

    expect(row!.country).toBe('United States');
    expect(row!.workplace).toBe('remote');
  });

  it('prefers a DB-stored company list over the env var', async () => {
    process.env.GREENHOUSE_COMPANIES = 'env-token:Env Co';
    vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
      key === 'greenhouse_companies' ? 'db-token:DB Co' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await greenhouseAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/db-token/jobs?content=true',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify the new one fails**

Run: `npx vitest run packages/web/lib/ingestion/greenhouse.test.ts`
Expected: the last test FAILS; the four pre-existing tests still PASS.

- [ ] **Step 3: Update `greenhouse.ts`**

Modify `packages/web/lib/ingestion/greenhouse.ts`. Change the import line and the first line of `fetchPostings`:

```ts
import type { IngestionAdapter, RawPosting } from './types.ts';
import { countryFromLocation, normalizeCountry, parseCompanyList } from './shared.ts';
import { getSetting } from '../settings-db.ts';
```

```ts
async function fetchPostings(): Promise<RawPosting[]> {
  const raw = (await getSetting('greenhouse_companies')) ?? process.env.GREENHOUSE_COMPANIES;
  const companies = parseCompanyList(raw);
  if (companies.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { token, displayName } of companies) {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`greenhouse: company "${token}" failed with ${response.status}`);
      continue;
    }
    const body = (await response.json()) as { jobs?: GreenhouseJob[] };
    for (const job of body.jobs ?? []) {
      const mapped = mapJob(job, displayName);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}
```

Everything else in the file is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/greenhouse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/greenhouse.ts packages/web/lib/ingestion/greenhouse.test.ts
git commit -m "web: greenhouse adapter reads settings from DB"
```

---

### Task 7: `lever.ts` reads settings from the DB

**Files:**
- Modify: `packages/web/lib/ingestion/lever.ts`
- Modify: `packages/web/lib/ingestion/lever.test.ts`

**Interfaces:**
- Consumes: `getSetting` from `../settings-db.ts` (Task 3).

- [ ] **Step 1: Read the existing `lever.test.ts` first**

Open `packages/web/lib/ingestion/lever.test.ts` and note its existing test names/assertions — it follows the exact same shape as `greenhouse.test.ts` before Task 6's edit (an "unconfigured" test, a "maps a response" test using `process.env.LEVER_COMPANIES`, and possibly a location-parsing edge-case test). Apply the same three changes Task 6 made to `greenhouse.test.ts`, adapted to Lever:

1. Add near the top, after the `greenhouseAdapter`-style import:
   ```ts
   import * as settingsDb from '../settings-db.ts';

   vi.mock('../settings-db.ts', () => ({
     getSetting: vi.fn().mockResolvedValue(null),
   }));
   ```
2. In the existing `afterEach`, add:
   ```ts
   vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
   ```
3. Add this new test at the end of the `describe` block:
   ```ts
   it('prefers a DB-stored company list over the env var', async () => {
     process.env.LEVER_COMPANIES = 'env-token:Env Co';
     vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
       key === 'lever_companies' ? 'db-token:DB Co' : null,
     );
     const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
     vi.stubGlobal('fetch', fetchMock);

     await leverAdapter.fetchPostings();

     expect(fetchMock).toHaveBeenCalledWith(
       'https://api.lever.co/v0/postings/db-token?mode=json',
       expect.objectContaining({ signal: expect.anything() }),
     );
   });
   ```

- [ ] **Step 2: Run the test to verify the new one fails**

Run: `npx vitest run packages/web/lib/ingestion/lever.test.ts`
Expected: the new test FAILS; pre-existing tests still PASS.

- [ ] **Step 3: Update `lever.ts`**

Modify `packages/web/lib/ingestion/lever.ts`. Change the import line and the first line of `fetchPostings`:

```ts
import type { IngestionAdapter, RawPosting } from './types.ts';
import { countryFromLocation, normalizeCountry, parseCompanyList } from './shared.ts';
import { getSetting } from '../settings-db.ts';
```

```ts
async function fetchPostings(): Promise<RawPosting[]> {
  const raw = (await getSetting('lever_companies')) ?? process.env.LEVER_COMPANIES;
  const companies = parseCompanyList(raw);
  if (companies.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { token, displayName } of companies) {
    const response = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`lever: company "${token}" failed with ${response.status}`);
      continue;
    }
    const body = (await response.json()) as LeverPosting[];
    for (const job of body) {
      const mapped = mapJob(job, displayName);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}
```

Everything else in the file is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/lever.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/lever.ts packages/web/lib/ingestion/lever.test.ts
git commit -m "web: lever adapter reads settings from DB"
```

---

### Task 8: `ashby.ts` reads settings from the DB

**Files:**
- Modify: `packages/web/lib/ingestion/ashby.ts`
- Modify: `packages/web/lib/ingestion/ashby.test.ts`

**Interfaces:**
- Consumes: `getSetting` from `../settings-db.ts` (Task 3).

- [ ] **Step 1: Update `ashby.test.ts`**

Same three changes as Task 6/7, adapted to Ashby:

1. Add near the top:
   ```ts
   import * as settingsDb from '../settings-db.ts';

   vi.mock('../settings-db.ts', () => ({
     getSetting: vi.fn().mockResolvedValue(null),
   }));
   ```
2. In the existing `afterEach`, add:
   ```ts
   vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
   ```
3. Add this new test at the end of the `describe` block:
   ```ts
   it('prefers a DB-stored company list over the env var', async () => {
     process.env.ASHBY_COMPANIES = 'env-token:Env Co';
     vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
       key === 'ashby_companies' ? 'db-token:DB Co' : null,
     );
     const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) });
     vi.stubGlobal('fetch', fetchMock);

     await ashbyAdapter.fetchPostings();

     expect(fetchMock).toHaveBeenCalledWith(
       'https://api.ashbyhq.com/posting-api/job-board/db-token',
       expect.objectContaining({ signal: expect.anything() }),
     );
   });
   ```

- [ ] **Step 2: Run the test to verify the new one fails**

Run: `npx vitest run packages/web/lib/ingestion/ashby.test.ts`
Expected: the new test FAILS; pre-existing tests still PASS.

- [ ] **Step 3: Update `ashby.ts`**

Modify `packages/web/lib/ingestion/ashby.ts`. Change the import line and the first line of `fetchPostings`:

```ts
import type { IngestionAdapter, RawPosting } from './types.ts';
import { countryFromLocation, normalizeCountry, parseCompanyList } from './shared.ts';
import { getSetting } from '../settings-db.ts';
```

```ts
async function fetchPostings(): Promise<RawPosting[]> {
  const raw = (await getSetting('ashby_companies')) ?? process.env.ASHBY_COMPANIES;
  const companies = parseCompanyList(raw);
  if (companies.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { token, displayName } of companies) {
    const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`ashby: company "${token}" failed with ${response.status}`);
      continue;
    }
    const body = (await response.json()) as { jobs?: AshbyJob[] };
    for (const job of body.jobs ?? []) {
      const mapped = mapJob(job, displayName);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}
```

Everything else in the file is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/ashby.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/ashby.ts packages/web/lib/ingestion/ashby.test.ts
git commit -m "web: ashby adapter reads settings from DB"
```

---

### Task 9: `GET`/`PUT /api/settings`

**Files:**
- Create: `packages/web/app/api/settings/route.ts`
- Test: `packages/web/app/api/settings/route.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `getSecretSetting`, `setSetting`, `setSecretSetting`, `clearSetting` from `../../../lib/settings-db.ts` (Task 3); `requireSession` from `../../../lib/require-session.ts`.
- Produces: `GET`, `PUT` route handlers returning `{ items: SettingItem[] }` where `SettingItem = { key: string; label: string; secret: boolean; value: string | null; isSet: boolean }` — Task 10's `settings-queries.ts` consumes this shape.

- [ ] **Step 1: Write the failing test**

Create `packages/web/app/api/settings/route.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/settings', () => {
  let authDb: typeof import('../../../lib/auth-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../lib/auth-db.ts');
    route = await import('./route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from app_settings`;
    await sql`delete from sessions`;
    await sql`delete from users`;
    delete process.env.JSEARCH_QUERIES;
    delete process.env.JSEARCH_API_KEY;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return sessionCookieHeader(sealed).split(';')[0]!;
  }

  it('GET returns 401 when not signed in', async () => {
    const response = await route.GET(new Request('http://localhost/api/settings'));
    expect(response.status).toBe(401);
  });

  it('GET reflects env-var fallback values and unset secrets', async () => {
    process.env.JSEARCH_QUERIES = 'staff engineer';
    process.env.JSEARCH_API_KEY = 'env-key';
    const cookie = await signedInCookie();
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null; isSet: boolean; secret: boolean }[] };
    const queries = body.items.find((item) => item.key === 'jsearch_queries');
    const apiKey = body.items.find((item) => item.key === 'jsearch_api_key');
    expect(queries).toMatchObject({ value: 'staff engineer', isSet: true, secret: false });
    expect(apiKey).toMatchObject({ value: null, isSet: true, secret: true });
  });

  it('PUT saves a non-secret value, which GET then reflects', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_queries: 'backend engineer' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null }[] };
    expect(body.items.find((item) => item.key === 'jsearch_queries')?.value).toBe('backend engineer');
  });

  it('PUT saves a secret value encrypted, which GET reflects only as isSet', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_api_key: 'a-real-key' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null; isSet: boolean }[] };
    expect(body.items.find((item) => item.key === 'jsearch_api_key')).toMatchObject({ value: null, isSet: true });

    const [row] = await sql`select value from app_settings where key = 'jsearch_api_key'`;
    expect(row!['value']).not.toBe('a-real-key');
  });

  it('PUT with an empty string clears a saved value, reverting to the env fallback', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_queries: 'backend engineer' }),
      }),
    );
    process.env.JSEARCH_QUERIES = 'env fallback query';
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_queries: '' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null }[] };
    expect(body.items.find((item) => item.key === 'jsearch_queries')?.value).toBe('env fallback query');
  });

  it('PUT rejects an unknown key', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ not_a_real_key: 'x' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (skipped if no local Postgres)**

Run: `TEST_DATABASE_URL=<your-test-db-url> npx vitest run packages/web/app/api/settings/route.test.ts`
Expected: FAIL — `./route.ts` doesn't exist yet.

- [ ] **Step 3: Implement `route.ts`**

Create `packages/web/app/api/settings/route.ts`:

```ts
import { clearSetting, getSecretSetting, getSetting, setSecretSetting, setSetting } from '../../../lib/settings-db.ts';
import { requireSession } from '../../../lib/require-session.ts';

type SettingConfig = { key: string; envVar?: string; secret: boolean; label: string };

const SETTINGS: SettingConfig[] = [
  { key: 'jsearch_api_key', envVar: 'JSEARCH_API_KEY', secret: true, label: 'JSearch API key' },
  { key: 'jsearch_queries', envVar: 'JSEARCH_QUERIES', secret: false, label: 'JSearch search queries (comma-separated)' },
  { key: 'jsearch_country', envVar: 'JSEARCH_COUNTRY', secret: false, label: 'JSearch country code (e.g. us)' },
  { key: 'adzuna_app_id', envVar: 'ADZUNA_APP_ID', secret: true, label: 'Adzuna app ID' },
  { key: 'adzuna_app_key', envVar: 'ADZUNA_APP_KEY', secret: true, label: 'Adzuna app key' },
  { key: 'adzuna_countries', envVar: 'ADZUNA_COUNTRIES', secret: false, label: 'Adzuna country codes (comma-separated)' },
  { key: 'adzuna_queries', envVar: 'ADZUNA_QUERIES', secret: false, label: 'Adzuna search queries (comma-separated)' },
  {
    key: 'greenhouse_companies',
    envVar: 'GREENHOUSE_COMPANIES',
    secret: false,
    label: 'Greenhouse companies (token:Display Name, comma-separated)',
  },
  {
    key: 'lever_companies',
    envVar: 'LEVER_COMPANIES',
    secret: false,
    label: 'Lever companies (token:Display Name, comma-separated)',
  },
  {
    key: 'ashby_companies',
    envVar: 'ASHBY_COMPANIES',
    secret: false,
    label: 'Ashby companies (token:Display Name, comma-separated)',
  },
];

const SETTINGS_BY_KEY = new Map(SETTINGS.map((config) => [config.key, config]));

type SettingItem = { key: string; label: string; secret: boolean; value: string | null; isSet: boolean };

async function currentItem(config: SettingConfig): Promise<SettingItem> {
  const envFallback = config.envVar ? (process.env[config.envVar] ?? null) : null;
  if (config.secret) {
    const value = (await getSecretSetting(config.key)) ?? envFallback;
    return { key: config.key, label: config.label, secret: true, value: null, isSet: Boolean(value) };
  }
  const value = (await getSetting(config.key)) ?? envFallback;
  return { key: config.key, label: config.label, secret: false, value, isSet: Boolean(value) };
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const items = await Promise.all(SETTINGS.map(currentItem));
  return Response.json({ items });
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  for (const key of Object.keys(body)) {
    const config = SETTINGS_BY_KEY.get(key);
    if (!config) {
      return Response.json({ error: `unknown setting "${key}"` }, { status: 400 });
    }
    const value = body[key];
    if (typeof value !== 'string') {
      return Response.json({ error: `"${key}" must be a string` }, { status: 400 });
    }
    if (value === '') {
      await clearSetting(key);
    } else if (config.secret) {
      await setSecretSetting(key, value);
    } else {
      await setSetting(key, value);
    }
  }

  const items = await Promise.all(SETTINGS.map(currentItem));
  return Response.json({ items });
}
```

- [ ] **Step 4: Run the test to verify it passes (skipped if no local Postgres)**

Run: `TEST_DATABASE_URL=<your-test-db-url> npx vitest run packages/web/app/api/settings/route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/settings/route.ts packages/web/app/api/settings/route.test.ts
git commit -m "web: add GET/PUT /api/settings"
```

---

### Task 10: `/settings` page

**Files:**
- Create: `packages/web/lib/settings-queries.ts`
- Create: `packages/web/app/settings/page.tsx`
- Create: `packages/web/app/settings/settings-view.tsx`
- Test: `packages/web/app/settings/settings-view.test.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/settings` (Task 9), returning `{ items: SettingItem[] }`.
- Produces: `SettingsView` (React component), rendered by `app/settings/page.tsx`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/app/settings/settings-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SettingsView } from './settings-view.tsx';

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

const ITEMS = [
  { key: 'jsearch_api_key', label: 'JSearch API key', secret: true, value: null, isSet: false },
  {
    key: 'jsearch_queries',
    label: 'JSearch search queries (comma-separated)',
    secret: false,
    value: 'staff engineer',
    isSet: true,
  },
  { key: 'adzuna_app_id', label: 'Adzuna app ID', secret: true, value: null, isSet: true },
];

describe('SettingsView', () => {
  it('shows a loading state, then a section per adapter with its fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: ITEMS })));
    renderWithClient(<SettingsView />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await screen.findByText('JSearch');
    expect(screen.getByLabelText('JSearch search queries (comma-separated)')).toHaveValue('staff engineer');
    expect(screen.getByText('Adzuna')).toBeInTheDocument();
  });

  it('shows "Not set" / "Currently set" for secret fields without ever showing their value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: ITEMS })));
    renderWithClient(<SettingsView />);

    await screen.findByText('JSearch');
    expect(screen.getByLabelText('JSearch API key')).toHaveValue('');
    expect(screen.getAllByText('Not set')).toHaveLength(1);
    expect(screen.getAllByText('Currently set')).toHaveLength(1);
  });

  it('saves only the fields touched in a section', async () => {
    const doFetch = vi.fn((_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse({ items: ITEMS }));
      return Promise.resolve(jsonResponse({ items: ITEMS }));
    });
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SettingsView />);

    await screen.findByText('JSearch');
    fireEvent.change(screen.getByLabelText('JSearch search queries (comma-separated)'), {
      target: { value: 'backend engineer' },
    });
    const jsearchSection = screen.getByText('JSearch').closest('.rounded-lg') as HTMLElement;
    fireEvent.click(within(jsearchSection).getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ jsearch_queries: 'backend engineer' }),
        }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/app/settings/settings-view.test.tsx`
Expected: FAIL — `./settings-view.ts(x)` doesn't exist yet.

- [ ] **Step 3: Implement `settings-queries.ts`**

Create `packages/web/lib/settings-queries.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type SettingItem = { key: string; label: string; secret: boolean; value: string | null; isSet: boolean };

type SettingsResponse = { items: SettingItem[] };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchJson<SettingsResponse>('/api/settings').then((data) => data.items),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, string>) =>
      fetchJson<SettingsResponse>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}
```

- [ ] **Step 4: Implement `settings-view.tsx`**

Create `packages/web/app/settings/settings-view.tsx`:

```tsx
'use client';

import { type FormEvent, useId, useState } from 'react';
import { type SettingItem, useSettings, useUpdateSettings } from '../../lib/settings-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

const ADAPTER_LABELS: Record<string, string> = {
  jsearch: 'JSearch',
  adzuna: 'Adzuna',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
};

function adapterOf(key: string): string {
  return key.split('_')[0]!;
}

function groupByAdapter(items: SettingItem[]): [string, SettingItem[]][] {
  const groups = new Map<string, SettingItem[]>();
  for (const item of items) {
    const adapter = adapterOf(item.key);
    const list = groups.get(adapter) ?? [];
    list.push(item);
    groups.set(adapter, list);
  }
  return [...groups.entries()];
}

function AdapterSection({ adapter, items }: { adapter: string; items: SettingItem[] }) {
  const uid = useId();
  const update = useUpdateSettings();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.key, item.secret ? '' : (item.value ?? '')])),
  );
  const [touched, setTouched] = useState<Set<string>>(new Set());

  function handleChange(key: string, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const body = Object.fromEntries([...touched].map((key) => [key, values[key] ?? '']));
    if (Object.keys(body).length === 0) return;
    update.mutate(body, { onSuccess: () => setTouched(new Set()) });
  }

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">{ADAPTER_LABELS[adapter] ?? adapter}</span>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-${item.key}`}>{item.label}</Label>
              <Input
                id={`${uid}-${item.key}`}
                type={item.secret ? 'password' : 'text'}
                value={values[item.key] ?? ''}
                placeholder={item.secret ? (item.isSet ? 'Set — leave blank to keep' : 'Not set') : undefined}
                onChange={(event) => handleChange(item.key, event.target.value)}
              />
              {item.secret && <p className="text-xs text-muted-foreground">{item.isSet ? 'Currently set' : 'Not set'}</p>}
            </div>
          ))}
          <Button type="submit" disabled={update.isPending || touched.size === 0} className="self-start">
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          {update.isError && (
            <p role="alert" className="text-sm text-destructive">
              {update.error.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  const { data: items, isLoading, isError, error } = useSettings();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Ingestion settings</h1>
      <p className="text-sm text-muted-foreground">
        These settings are shared instance-wide, not per account — postings ingestion runs once for everyone. A saved
        value here overrides the matching environment variable; clearing a field (Save with it blank) reverts to the
        environment variable, if any.
      </p>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {items && (
        <div className="flex flex-col gap-3">
          {groupByAdapter(items).map(([adapter, adapterItems]) => (
            <AdapterSection key={adapter} adapter={adapter} items={adapterItems} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `page.tsx`**

Create `packages/web/app/settings/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readCurrentUser } from '../../lib/require-session.ts';
import { SettingsView } from './settings-view.tsx';

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const user = await readCurrentUser(cookieHeader);
  if (!user) redirect('/sign-in');

  return <SettingsView />;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/web/app/settings/settings-view.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/settings-queries.ts packages/web/app/settings
git commit -m "web: add /settings page"
```

---

### Task 11: Nav link, README, and `.env.example`

**Files:**
- Modify: `packages/web/components/app-nav.tsx`
- Modify: `packages/web/README.md`
- Modify: `packages/web/.env.example`

**Interfaces:**
- None — this task only wires up navigation and documentation for what Tasks 1–10 already built. No new test (no existing test covers `app-nav.tsx`, and doc changes aren't independently testable).

- [ ] **Step 1: Add the nav link**

In `packages/web/components/app-nav.tsx`, add a `Settings` link after the `Profile` link (still inside the `signedIn` branch):

```tsx
            <Link href="/profile" className="hover:underline">
              Profile
            </Link>
            <Link href="/settings" className="hover:underline">
              Settings
            </Link>
```

- [ ] **Step 2: Add `JSEARCH_COUNTRY` to `.env.example`**

In `packages/web/.env.example`, change:

```
JSEARCH_API_KEY=
JSEARCH_QUERIES=
```

to:

```
JSEARCH_API_KEY=
JSEARCH_QUERIES=
JSEARCH_COUNTRY=
```

- [ ] **Step 3: Update `README.md`**

In `packages/web/README.md`, in the "Configuring postings ingestion" section, add a sentence to the JSearch bullet noting the new country option, and add a closing paragraph after the adapter list (before the "Ingestion runs two ways" paragraph) explaining the settings page. Change the JSearch bullet from:

```
- **JSearch** (aggregator, sourced from Google for Jobs — covers Indeed/
  LinkedIn/Glassdoor listings indirectly): `JSEARCH_API_KEY` (a RapidAPI
  key for the [JSearch API](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch))
  and `JSEARCH_QUERIES`, a comma-separated list of search terms, e.g.
  `JSEARCH_QUERIES=staff software engineer,senior backend engineer`. One
  request is made per query.
```

to:

```
- **JSearch** (aggregator, sourced from Google for Jobs — covers Indeed/
  LinkedIn/Glassdoor listings indirectly): `JSEARCH_API_KEY` (a RapidAPI
  key for the [JSearch API](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch))
  and `JSEARCH_QUERIES`, a comma-separated list of search terms, e.g.
  `JSEARCH_QUERIES=staff software engineer,senior backend engineer`. One
  request is made per query. `JSEARCH_COUNTRY` (optional, a two-letter
  code, e.g. `us`) scopes every query to that country.
```

Then add this paragraph right after the bulleted adapter list, before the `Ingestion runs two ways` paragraph:

```
All of the above (except the ATS company lists' underlying tokens, which
are just what a company's own careers-board URL uses) can also be set from
the running app at `/settings`, instead of editing these env vars — any
signed-in account can view/edit them there, since ingestion is a single
instance-wide job, not scoped per account. A value saved from `/settings`
overrides its matching env var here; clearing it in the app (saving it
blank) reverts to whatever's in the env var, if anything. API keys saved
from `/settings` are encrypted at rest before being stored.
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/app-nav.tsx packages/web/README.md packages/web/.env.example
git commit -m "web: link /settings from nav, document it in README"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), secrets/encryption (Task 2), `settings-db.ts` DB-overrides-env helpers (Task 3), all five adapters (Tasks 4–8, including the new `jsearch_country`), the API route with its `isSet`-only secret exposure and empty-string-clears semantics (Task 9), the settings page (Task 10), README/env-var documentation update (Task 11 — matches the spec's "Migration/rollout note" requirement that the env docs stay accurate and get a short addition, not a removal). All covered.
- **Type consistency checked:** `SettingItem` (`{ key, label, secret, value, isSet }`) is defined once in `app/api/settings/route.ts` (Task 9) and its shape is reused verbatim in `lib/settings-queries.ts` (Task 10) and the test fixtures in `settings-view.test.tsx`. `getSetting`/`getSecretSetting`/`setSetting`/`setSecretSetting`/`clearSetting` signatures from Task 3 are used identically (same names, same `Promise<string | null>` / `Promise<void>` shapes) across every adapter and the route.
- **No placeholders:** every step above has literal, runnable code — no adapter's change is described as "similar to Task N" without the actual diff shown.

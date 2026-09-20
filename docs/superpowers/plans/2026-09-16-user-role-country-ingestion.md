# Per-user roles/countries ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each account set up to 5 roles and 3 countries at `/profile`, and make JSearch/Adzuna ingestion query per-account roles/countries (deduped across accounts) instead of admin-configured env vars/settings.

**Architecture:** New `user_preferences` table holds each account's `roles`/`countries` arrays, edited via a new `/api/user-preferences` route and a new `RolePreferencesCard` on `/profile`. A new `lib/ingestion/user-query-pairs.ts` loads the distinct `(role, country)` pairs across every account with both set; `jsearch.ts` and `adzuna.ts` loop over those pairs instead of env/settings-configured queries/countries. Everything downstream of `postings` (judging, tailoring, apply, routines) is untouched.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (Postgres), TanStack React Query, Vitest + Testing Library, TypeScript (`.ts`/`.tsx` extensions kept in imports, matching this repo's existing convention).

**Spec:** `docs/superpowers/specs/2026-09-16-user-role-country-ingestion-design.md`

## Global Constraints

- Roles cap: 5 per account. Countries cap: 3 per account.
- Countries are restricted to the codes in `lib/ingestion/adzuna-countries.ts` (Adzuna's supported set — the stricter of the two per-user-driven adapters).
- `(role, country)` pairs are deduped across *all* accounts before either adapter is called — never call once per account for a pair other accounts already cover.
- `postings`, judging, tailoring, apply, and `routines` are not modified by this plan.
- Every DB-backed test in this repo uses `describe.skipIf(!process.env.TEST_DATABASE_URL)` — run it against a real Postgres (`TEST_DATABASE_URL` set) at least once per the README's own testing instructions; a SKIPPED result without that is not evidence the code works.
- All commands below run from the repo root (`C:\Users\okech\OneDrive - Rivia\Documents 1\GitHub\talenttrove-cli`) unless a task says otherwise; the test runner is `npx vitest run <path>` (root `vitest.config.ts` already includes `packages/web/**/*.test.{ts,tsx}`).

---

### Task 1: `user_preferences` table

**Files:**
- Modify: `packages/web/db/schema.ts`
- Modify: `packages/web/db/schema.test.ts`
- Create: a new migration file under `packages/web/db/migrations/` (generated, not hand-written)

**Interfaces:**
- Produces: `userPreferences` Drizzle table (`userId` PK/FK to `users.id`, `roles: text[]`, `countries: text[]`, `updatedAt`), imported by Task 3 and Task 4 as `userPreferences` from `../db/schema.ts` / `../../db/schema.ts`.

- [ ] **Step 1: Write the failing schema test**

Add to `packages/web/db/schema.test.ts` (after the existing `it('adds a country column...')` block, same file):

```ts
  it('creates user_preferences', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
      and table_name = 'user_preferences'
    `;
    expect(rows).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it to verify it fails (or is skipped without a test DB)**

Run: `npx vitest run packages/web/db/schema.test.ts`
Expected: if `TEST_DATABASE_URL` is set, FAIL (`expected [] to have length 1`); otherwise the whole suite reports SKIPPED.

- [ ] **Step 3: Add the table to the schema**

In `packages/web/db/schema.ts`, add right after the `profileDocuments` table definition (after its closing `);` around line 52):

```ts
export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  roles: text('roles').array(),
  countries: text('countries').array(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

(`uuid`, `text`, `timestamp`, `pgTable` are already imported at the top of this file.)

- [ ] **Step 4: Generate the migration**

Run (from `packages/web`): `npx drizzle-kit generate`
Expected: a new file appears under `packages/web/db/migrations/` (drizzle auto-names it, e.g. `0009_<random-name>.sql`) containing `CREATE TABLE "user_preferences" (...)`. Open it and confirm it matches the columns above.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/web/db/schema.test.ts`
Expected: PASS if `TEST_DATABASE_URL` is set (this migration must actually run against a real Postgres at least once — see Global Constraints); otherwise SKIPPED.

- [ ] **Step 6: Commit**

```bash
git add packages/web/db/schema.ts packages/web/db/schema.test.ts packages/web/db/migrations/
git commit -m "db: add user_preferences table for per-account roles/countries"
```

---

### Task 2: Adzuna-supported country list

**Files:**
- Create: `packages/web/lib/ingestion/adzuna-countries.ts`
- Create: `packages/web/lib/ingestion/adzuna-countries.test.ts`

**Interfaces:**
- Produces: `ADZUNA_COUNTRIES: readonly string[]` — consumed by Task 6 (`adzuna.ts` no change needed here, it already loops given countries), Task 7 (`/api/user-preferences` validation), and Task 9 (`RolePreferencesCard`'s country picker).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/lib/ingestion/adzuna-countries.test.ts
import { describe, expect, it } from 'vitest';
import { ADZUNA_COUNTRIES } from './adzuna-countries.ts';

describe('ADZUNA_COUNTRIES', () => {
  it('is non-empty and every entry is a lowercase two-letter code', () => {
    expect(ADZUNA_COUNTRIES.length).toBeGreaterThan(0);
    for (const code of ADZUNA_COUNTRIES) {
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(ADZUNA_COUNTRIES).size).toBe(ADZUNA_COUNTRIES.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/web/lib/ingestion/adzuna-countries.test.ts`
Expected: FAIL with a module-not-found error for `./adzuna-countries.ts`.

- [ ] **Step 3: Write the list**

```ts
// packages/web/lib/ingestion/adzuna-countries.ts
/**
 * Two-letter country codes Adzuna's API supports. Used to constrain the
 * `/profile` country picker and validate `PUT /api/user-preferences` --
 * Adzuna is the stricter of the two per-user-driven adapters (JSearch's
 * `country` param accepts a broader set), so this list is the shared cap
 * for both.
 */
export const ADZUNA_COUNTRIES: readonly string[] = [
  'at',
  'au',
  'br',
  'ca',
  'de',
  'es',
  'fr',
  'gb',
  'in',
  'it',
  'mx',
  'nl',
  'nz',
  'pl',
  'sg',
  'us',
  'za',
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/adzuna-countries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/adzuna-countries.ts packages/web/lib/ingestion/adzuna-countries.test.ts
git commit -m "ingestion: add Adzuna-supported country list"
```

---

### Task 3: `user-preferences-db.ts`

**Files:**
- Create: `packages/web/lib/user-preferences-db.ts`
- Create: `packages/web/lib/user-preferences-db.test.ts`

**Interfaces:**
- Consumes: `userPreferences` table from `../db/schema.ts` (Task 1); `getDb` from `./db.ts`.
- Produces: `getUserPreferences(userId: string): Promise<{ roles: string[]; countries: string[] } | null>` and `setUserPreferences(userId: string, roles: string[], countries: string[]): Promise<void>` — consumed by Task 7's route.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/lib/user-preferences-db.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('user-preferences-db', () => {
  let authDb: typeof import('./auth-db.ts');
  let userPreferencesDb: typeof import('./user-preferences-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    userPreferencesDb = await import('./user-preferences-db.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from user_preferences`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function freshUserId(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    return user.id;
  }

  it('returns null for a user with no stored preferences', async () => {
    const userId = await freshUserId();
    expect(await userPreferencesDb.getUserPreferences(userId)).toBeNull();
  });

  it('stores and retrieves roles and countries', async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['staff software engineer'], ['us', 'gb']);
    expect(await userPreferencesDb.getUserPreferences(userId)).toEqual({
      roles: ['staff software engineer'],
      countries: ['us', 'gb'],
    });
  });

  it('a second call overwrites rather than duplicating the row', async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['role one'], ['us']);
    await userPreferencesDb.setUserPreferences(userId, ['role two'], ['gb']);

    expect(await userPreferencesDb.getUserPreferences(userId)).toEqual({ roles: ['role two'], countries: ['gb'] });
    const rows = await sql`select * from user_preferences where user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/web/lib/user-preferences-db.test.ts`
Expected: FAIL (module not found for `./user-preferences-db.ts`) if `TEST_DATABASE_URL` is set; otherwise SKIPPED.

- [ ] **Step 3: Write the implementation**

```ts
// packages/web/lib/user-preferences-db.ts
import { eq } from 'drizzle-orm';
import { getDb } from './db.ts';
import { userPreferences } from '../db/schema.ts';

export type UserPreferences = { roles: string[]; countries: string[] };

export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  const [row] = await getDb().select().from(userPreferences).where(eq(userPreferences.userId, userId));
  if (!row) return null;
  return { roles: row.roles ?? [], countries: row.countries ?? [] };
}

export async function setUserPreferences(userId: string, roles: string[], countries: string[]): Promise<void> {
  await getDb()
    .insert(userPreferences)
    .values({ userId, roles, countries, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { roles, countries, updatedAt: new Date() } });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/user-preferences-db.test.ts`
Expected: PASS if `TEST_DATABASE_URL` is set; otherwise SKIPPED.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/user-preferences-db.ts packages/web/lib/user-preferences-db.test.ts
git commit -m "web: add user-preferences-db get/set helpers"
```

---

### Task 4: `user-query-pairs.ts`

**Files:**
- Create: `packages/web/lib/ingestion/user-query-pairs.ts`
- Create: `packages/web/lib/ingestion/user-query-pairs.test.ts`

**Interfaces:**
- Consumes: `userPreferences` table from `../../db/schema.ts` (Task 1); `getDb` from `../db.ts`.
- Produces: `type QueryPair = { role: string; country: string }` and `loadDistinctQueryPairs(): Promise<QueryPair[]>` — consumed by Task 5 (`jsearch.ts`) and Task 6 (`adzuna.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/lib/ingestion/user-query-pairs.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('loadDistinctQueryPairs', () => {
  let authDb: typeof import('../auth-db.ts');
  let userPreferencesDb: typeof import('../user-preferences-db.ts');
  let userQueryPairs: typeof import('./user-query-pairs.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../auth-db.ts');
    userPreferencesDb = await import('../user-preferences-db.ts');
    userQueryPairs = await import('./user-query-pairs.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from user_preferences`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function freshUserId(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    return user.id;
  }

  it('returns an empty list when no account has preferences', async () => {
    expect(await userQueryPairs.loadDistinctQueryPairs()).toEqual([]);
  });

  it('returns the cross product of one account\'s roles and countries', async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['backend engineer', 'staff engineer'], ['us', 'gb']);

    const pairs = await userQueryPairs.loadDistinctQueryPairs();
    expect(pairs).toHaveLength(4);
    expect(pairs).toEqual(
      expect.arrayContaining([
        { role: 'backend engineer', country: 'us' },
        { role: 'backend engineer', country: 'gb' },
        { role: 'staff engineer', country: 'us' },
        { role: 'staff engineer', country: 'gb' },
      ]),
    );
  });

  it('dedupes an identical pair shared by two accounts', async () => {
    const userA = await freshUserId();
    const userB = await freshUserId();
    await userPreferencesDb.setUserPreferences(userA, ['backend engineer'], ['us']);
    await userPreferencesDb.setUserPreferences(userB, ['backend engineer'], ['us']);

    const pairs = await userQueryPairs.loadDistinctQueryPairs();
    expect(pairs).toEqual([{ role: 'backend engineer', country: 'us' }]);
  });

  it('contributes nothing for an account with only roles or only countries set', async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['backend engineer'], []);

    expect(await userQueryPairs.loadDistinctQueryPairs()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/web/lib/ingestion/user-query-pairs.test.ts`
Expected: FAIL (module not found) if `TEST_DATABASE_URL` is set; otherwise SKIPPED.

- [ ] **Step 3: Write the implementation**

```ts
// packages/web/lib/ingestion/user-query-pairs.ts
import { and, gt, sql as sqlOp } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { userPreferences } from '../../db/schema.ts';

export type QueryPair = { role: string; country: string };

export async function loadDistinctQueryPairs(): Promise<QueryPair[]> {
  const rows = await getDb()
    .select({ roles: userPreferences.roles, countries: userPreferences.countries })
    .from(userPreferences)
    .where(
      and(
        gt(sqlOp<number>`coalesce(array_length(${userPreferences.roles}, 1), 0)`, 0),
        gt(sqlOp<number>`coalesce(array_length(${userPreferences.countries}, 1), 0)`, 0),
      ),
    );

  const seen = new Set<string>();
  const pairs: QueryPair[] = [];
  for (const row of rows) {
    for (const role of row.roles ?? []) {
      for (const country of row.countries ?? []) {
        const key = `${role}\u0000${country}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ role, country });
      }
    }
  }
  return pairs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/user-query-pairs.test.ts`
Expected: PASS if `TEST_DATABASE_URL` is set; otherwise SKIPPED.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/user-query-pairs.ts packages/web/lib/ingestion/user-query-pairs.test.ts
git commit -m "ingestion: load distinct (role, country) pairs across accounts"
```

---

### Task 5: `jsearch.ts` reads pairs instead of settings-configured queries

**Files:**
- Modify: `packages/web/lib/ingestion/jsearch.ts`
- Modify: `packages/web/lib/ingestion/jsearch.test.ts`

**Interfaces:**
- Consumes: `loadDistinctQueryPairs` from `./user-query-pairs.ts` (Task 4).
- Produces: `jsearchAdapter: IngestionAdapter` (unchanged shape/export name — `run-ingestion.ts` needs no change).

- [ ] **Step 1: Replace the test file**

Replace the full contents of `packages/web/lib/ingestion/jsearch.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsearchAdapter } from './jsearch.ts';
import * as settingsDb from '../settings-db.ts';
import * as userQueryPairs from './user-query-pairs.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock('./user-query-pairs.ts', () => ({
  loadDistinctQueryPairs: vi.fn().mockResolvedValue([]),
}));

describe('jsearchAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockReset().mockResolvedValue([]);
    delete process.env.JSEARCH_API_KEY;
  });

  it('returns nothing and never calls fetch when no API key is configured', async () => {
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await jsearchAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing and never calls fetch when there are no query pairs', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await jsearchAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a JSearch response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          jobs: [
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
        },
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

  it('queries once per (role, country) pair, appending each pair\'s own country param', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([
      { role: 'staff engineer', country: 'us' },
      { role: 'staff engineer', country: 'gb' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { jobs: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('&country=us'), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('&country=gb'), expect.anything());
  });

  it('prefers a DB-stored API key over the env var', async () => {
    process.env.JSEARCH_API_KEY = 'env-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) =>
      key === 'jsearch_api_key' ? 'db-key' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { jobs: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'db-key' }) }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/web/lib/ingestion/jsearch.test.ts`
Expected: FAIL — the old `jsearch.ts` still reads `jsearch_queries`/`jsearch_country`, so `loadDistinctQueryPairs` is never called and the "queries once per pair" / "no API key" assertions fail.

- [ ] **Step 3: Update the implementation**

In `packages/web/lib/ingestion/jsearch.ts`, replace the import line and `fetchPostings` function:

```ts
import type { IngestionAdapter, RawPosting } from './types.ts';
import { normalizeCountry } from './shared.ts';
import { getSecretSetting } from '../settings-db.ts';
import { loadDistinctQueryPairs } from './user-query-pairs.ts';
```

```ts
async function fetchPostings(): Promise<RawPosting[]> {
  const apiKey = (await getSecretSetting('jsearch_api_key')) ?? process.env.JSEARCH_API_KEY;
  if (!apiKey) return [];
  const pairs = await loadDistinctQueryPairs();
  if (pairs.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { role, country } of pairs) {
    const url = `${JSEARCH_ENDPOINT}?query=${encodeURIComponent(role)}&num_pages=1&country=${encodeURIComponent(country)}`;
    const response = await fetch(url, {
      headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`jsearch: query "${role}" (${country}) failed with ${response.status}`);
      continue;
    }
    const body = (await response.json()) as { data?: { jobs?: JSearchJob[] } };
    for (const job of body.data?.jobs ?? []) {
      const mapped = mapJob(job);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}
```

(Everything else in the file — `JSEARCH_ENDPOINT`, `JSearchJob`, `mapEmployment`, `mapJob`, the final `export const jsearchAdapter = ...` — is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/jsearch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/jsearch.ts packages/web/lib/ingestion/jsearch.test.ts
git commit -m "ingestion: jsearch queries per-account (role, country) pairs"
```

---

### Task 6: `adzuna.ts` reads pairs instead of settings-configured queries/countries

**Files:**
- Modify: `packages/web/lib/ingestion/adzuna.ts`
- Modify: `packages/web/lib/ingestion/adzuna.test.ts`

**Interfaces:**
- Consumes: `loadDistinctQueryPairs` from `./user-query-pairs.ts` (Task 4).
- Produces: `adzunaAdapter: IngestionAdapter` (unchanged shape/export name).

- [ ] **Step 1: Replace the test file**

Replace the full contents of `packages/web/lib/ingestion/adzuna.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adzunaAdapter } from './adzuna.ts';
import * as settingsDb from '../settings-db.ts';
import * as userQueryPairs from './user-query-pairs.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock('./user-query-pairs.ts', () => ({
  loadDistinctQueryPairs: vi.fn().mockResolvedValue([]),
}));

describe('adzunaAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockReset().mockResolvedValue([]);
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await adzunaAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing and never calls fetch when there are no query pairs', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await adzunaAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an Adzuna response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
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

  it('queries once per (role, country) pair', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([
      { role: 'staff engineer', country: 'us' },
      { role: 'staff engineer', country: 'gb' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await adzunaAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/jobs/us/search/1'), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/jobs/gb/search/1'), expect.anything());
  });

  it('prefers DB-stored app id/key over env vars', async () => {
    process.env.ADZUNA_APP_ID = 'env-id';
    process.env.ADZUNA_APP_KEY = 'env-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) => {
      if (key === 'adzuna_app_id') return 'db-id';
      if (key === 'adzuna_app_key') return 'db-key';
      return null;
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await adzunaAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/us/search/1?app_id=db-id&app_key=db-key&what=staff%20engineer'),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/web/lib/ingestion/adzuna.test.ts`
Expected: FAIL — the old `adzuna.ts` still reads `adzuna_countries`/`adzuna_queries`, so it never calls `loadDistinctQueryPairs` and the pair-driven assertions fail.

- [ ] **Step 3: Update the implementation**

In `packages/web/lib/ingestion/adzuna.ts`, replace the import line and `fetchPostings` function:

```ts
import type { IngestionAdapter, RawPosting } from './types.ts';
import { normalizeCountry } from './shared.ts';
import { getSecretSetting } from '../settings-db.ts';
import { loadDistinctQueryPairs } from './user-query-pairs.ts';
```

```ts
async function fetchPostings(): Promise<RawPosting[]> {
  const appId = (await getSecretSetting('adzuna_app_id')) ?? process.env.ADZUNA_APP_ID;
  const appKey = (await getSecretSetting('adzuna_app_key')) ?? process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return [];
  const pairs = await loadDistinctQueryPairs();
  if (pairs.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { role, country } of pairs) {
    const url = `${ADZUNA_ENDPOINT}/${country}/search/1?app_id=${appId}&app_key=${appKey}&what=${encodeURIComponent(role)}&content-type=application/json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      console.error(`adzuna: ${country}/"${role}" failed with ${response.status}`);
      continue;
    }
    const body = (await response.json()) as { results?: AdzunaJob[] };
    for (const job of body.results ?? []) {
      const mapped = mapJob(job, country);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}
```

(Everything else in the file — `ADZUNA_ENDPOINT`, `AdzunaJob`, `mapEmployment`, `mapJob`, the final `export const adzunaAdapter = ...` — is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/lib/ingestion/adzuna.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/ingestion/adzuna.ts packages/web/lib/ingestion/adzuna.test.ts
git commit -m "ingestion: adzuna queries per-account (role, country) pairs"
```

---

### Task 7: `/api/user-preferences` route

**Files:**
- Create: `packages/web/app/api/user-preferences/route.ts`
- Create: `packages/web/app/api/user-preferences/route.test.ts`

**Interfaces:**
- Consumes: `getUserPreferences`/`setUserPreferences` from `../../../lib/user-preferences-db.ts` (Task 3); `requireSession` from `../../../lib/require-session.ts`; `ADZUNA_COUNTRIES` from `../../../lib/ingestion/adzuna-countries.ts` (Task 2).
- Produces: `GET`/`PUT` handlers returning `{ roles: string[]; countries: string[] }` JSON — consumed by Task 9's React Query hooks.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/app/api/user-preferences/route.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/user-preferences', () => {
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
    await sql`delete from user_preferences`;
    await sql`delete from sessions`;
    await sql`delete from users`;
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
    const response = await route.GET(new Request('http://localhost/api/user-preferences'));
    expect(response.status).toBe(401);
  });

  it('GET returns empty defaults for an account with nothing stored', async () => {
    const cookie = await signedInCookie();
    const response = await route.GET(new Request('http://localhost/api/user-preferences', { headers: { cookie } }));
    expect(await response.json()).toEqual({ roles: [], countries: [] });
  });

  it('PUT saves roles/countries, which GET then reflects', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['staff engineer'], countries: ['us', 'gb'] }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/user-preferences', { headers: { cookie } }));
    expect(await response.json()).toEqual({ roles: ['staff engineer'], countries: ['us', 'gb'] });
  });

  it('PUT rejects more than 5 roles', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['a', 'b', 'c', 'd', 'e', 'f'], countries: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('PUT rejects more than 3 countries', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [], countries: ['us', 'gb', 'ca', 'de'] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('PUT rejects a country code Adzuna does not support', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [], countries: ['zz'] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('PUT rejects a non-array body', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: 'not-an-array', countries: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/web/app/api/user-preferences/route.test.ts`
Expected: FAIL (module not found for `./route.ts`) if `TEST_DATABASE_URL` is set; otherwise SKIPPED.

- [ ] **Step 3: Write the implementation**

```ts
// packages/web/app/api/user-preferences/route.ts
import { getUserPreferences, setUserPreferences } from '../../../lib/user-preferences-db.ts';
import { requireSession } from '../../../lib/require-session.ts';
import { ADZUNA_COUNTRIES } from '../../../lib/ingestion/adzuna-countries.ts';

const MAX_ROLES = 5;
const MAX_COUNTRIES = 3;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const prefs = await getUserPreferences(auth.user.userId);
  return Response.json(prefs ?? { roles: [], countries: [] });
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const body = (await request.json().catch(() => null)) as { roles?: unknown; countries?: unknown } | null;
  if (!body || !Array.isArray(body.roles) || !Array.isArray(body.countries)) {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const roles = body.roles.map((role) => (typeof role === 'string' ? role.trim() : '')).filter(Boolean);
  const countries = body.countries.map((country) => (typeof country === 'string' ? country.trim().toLowerCase() : ''));

  if (roles.length > MAX_ROLES) {
    return Response.json({ error: `at most ${MAX_ROLES} roles are allowed` }, { status: 400 });
  }
  if (countries.length > MAX_COUNTRIES) {
    return Response.json({ error: `at most ${MAX_COUNTRIES} countries are allowed` }, { status: 400 });
  }
  const unsupported = countries.find((country) => !ADZUNA_COUNTRIES.includes(country));
  if (unsupported) {
    return Response.json({ error: `"${unsupported}" is not a supported country code` }, { status: 400 });
  }

  await setUserPreferences(auth.user.userId, roles, countries);
  return Response.json({ roles, countries });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/app/api/user-preferences/route.test.ts`
Expected: PASS if `TEST_DATABASE_URL` is set; otherwise SKIPPED.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/user-preferences/route.ts packages/web/app/api/user-preferences/route.test.ts
git commit -m "web: add GET/PUT /api/user-preferences"
```

---

### Task 8: React Query hooks for user preferences

**Files:**
- Create: `packages/web/lib/user-preferences-queries.ts`

**Interfaces:**
- Produces: `type UserPreferences = { roles: string[]; countries: string[] }`, `useUserPreferences()`, `useUpdateUserPreferences()` — consumed by Task 9's `RolePreferencesCard`.

No standalone test for this file — it's thin plumbing over `fetch`, exercised through Task 9's component test (mirrors `lib/settings-queries.ts`, which is untested on its own for the same reason).

- [ ] **Step 1: Write the hooks**

```ts
// packages/web/lib/user-preferences-queries.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type UserPreferences = { roles: string[]; countries: string[] };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

export function useUserPreferences() {
  return useQuery({
    queryKey: ['user-preferences'],
    queryFn: () => fetchJson<UserPreferences>('/api/user-preferences'),
  });
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UserPreferences) =>
      fetchJson<UserPreferences>('/api/user-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-preferences'] }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: no new errors from this file (Task 9 will exercise it at runtime via its component test).

- [ ] **Step 3: Commit**

```bash
git add packages/web/lib/user-preferences-queries.ts
git commit -m "web: add useUserPreferences/useUpdateUserPreferences hooks"
```

---

### Task 9: `RolePreferencesCard` on `/profile`

**Files:**
- Create: `packages/web/app/profile/role-preferences-card.tsx`
- Create: `packages/web/app/profile/role-preferences-card.test.tsx`
- Modify: `packages/web/app/profile/profile-editor.tsx`

**Interfaces:**
- Consumes: `useUserPreferences`/`useUpdateUserPreferences` from `../../lib/user-preferences-queries.ts` (Task 8); `ADZUNA_COUNTRIES` from `../../lib/ingestion/adzuna-countries.ts` (Task 2); `Badge`, `Button`, `Card`/`CardContent`/`CardHeader`, `Input`, `Label` from `../../components/ui/*.tsx`.
- Produces: `RolePreferencesCard` component, rendered by `ProfileEditor`.

- [ ] **Step 1: Write the failing component test**

```tsx
// packages/web/app/profile/role-preferences-card.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RolePreferencesCard } from './role-preferences-card.tsx';

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

describe('RolePreferencesCard', () => {
  it('loads and displays stored roles and countries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ roles: ['staff software engineer'], countries: ['us'] })),
    );
    renderWithClient(<RolePreferencesCard />);

    expect(await screen.findByText('staff software engineer')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
  });

  it('adds a role from the input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ roles: [], countries: [] })));
    renderWithClient(<RolePreferencesCard />);

    const input = await screen.findByPlaceholderText('e.g. senior backend engineer');
    fireEvent.change(input, { target: { value: 'backend engineer' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText('backend engineer')).toBeInTheDocument();
    expect(screen.getByText('Roles (1/5)')).toBeInTheDocument();
  });

  it('removes a role when its remove button is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ roles: ['backend engineer'], countries: [] })));
    renderWithClient(<RolePreferencesCard />);

    await screen.findByText('backend engineer');
    fireEvent.click(screen.getByRole('button', { name: 'Remove backend engineer' }));

    await waitFor(() => expect(screen.queryByText('backend engineer')).not.toBeInTheDocument());
  });

  it('disables unselected countries once 3 are picked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ roles: [], countries: ['us', 'gb', 'ca'] })));
    renderWithClient(<RolePreferencesCard />);

    await screen.findByText('Countries (3/3)');
    const unselected = screen.getByText('DE').closest('button') as HTMLButtonElement;
    expect(unselected).toBeDisabled();
  });

  it('saves the edited roles and countries', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ roles: [], countries: [] }))
      .mockResolvedValue(jsonResponse({ roles: ['backend engineer'], countries: ['us'] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<RolePreferencesCard />);

    const input = await screen.findByPlaceholderText('e.g. senior backend engineer');
    fireEvent.change(input, { target: { value: 'backend engineer' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    fireEvent.click(screen.getByText('US').closest('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/user-preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ roles: ['backend engineer'], countries: ['us'] }),
        }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/web/app/profile/role-preferences-card.test.tsx`
Expected: FAIL (module not found for `./role-preferences-card.tsx`).

- [ ] **Step 3: Write the component**

```tsx
// packages/web/app/profile/role-preferences-card.tsx
'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { ADZUNA_COUNTRIES } from '../../lib/ingestion/adzuna-countries.ts';
import { useUpdateUserPreferences, useUserPreferences } from '../../lib/user-preferences-queries.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

const MAX_ROLES = 5;
const MAX_COUNTRIES = 3;

export function RolePreferencesCard() {
  const { data, isLoading, isError, error } = useUserPreferences();
  const update = useUpdateUserPreferences();
  const [roles, setRoles] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [roleDraft, setRoleDraft] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && data) {
      setRoles(data.roles);
      setCountries(data.countries);
    }
  }, [data, touched]);

  function addRole(event: FormEvent): void {
    event.preventDefault();
    const value = roleDraft.trim();
    if (!value || roles.length >= MAX_ROLES || roles.includes(value)) return;
    setRoles([...roles, value]);
    setRoleDraft('');
    setTouched(true);
  }

  function removeRole(role: string): void {
    setRoles(roles.filter((existing) => existing !== role));
    setTouched(true);
  }

  function toggleCountry(country: string): void {
    if (countries.includes(country)) {
      setCountries(countries.filter((existing) => existing !== country));
      setTouched(true);
    } else if (countries.length < MAX_COUNTRIES) {
      setCountries([...countries, country]);
      setTouched(true);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Roles &amp; countries</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-draft">
                Roles ({roles.length}/{MAX_ROLES})
              </Label>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <Badge key={role} variant="secondary" className="gap-1">
                    <span>{role}</span>
                    <button type="button" aria-label={`Remove ${role}`} onClick={() => removeRole(role)} className="ml-1">
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
              <form onSubmit={addRole} className="flex gap-2">
                <Input
                  id="role-draft"
                  value={roleDraft}
                  onChange={(event) => setRoleDraft(event.target.value)}
                  placeholder="e.g. senior backend engineer"
                  disabled={roles.length >= MAX_ROLES}
                />
                <Button type="submit" variant="outline" disabled={roles.length >= MAX_ROLES || !roleDraft.trim()}>
                  Add
                </Button>
              </form>
            </div>
            <div className="flex flex-col gap-2">
              <Label>
                Countries ({countries.length}/{MAX_COUNTRIES})
              </Label>
              <div className="flex flex-wrap gap-2">
                {ADZUNA_COUNTRIES.map((country) => {
                  const selected = countries.includes(country);
                  return (
                    <button
                      key={country}
                      type="button"
                      onClick={() => toggleCountry(country)}
                      disabled={!selected && countries.length >= MAX_COUNTRIES}
                      aria-pressed={selected}
                    >
                      <Badge variant={selected ? 'default' : 'outline'}>{country.toUpperCase()}</Badge>
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ roles, countries }, { onSuccess: () => setTouched(false) })}
              className="self-start"
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
            {update.isError && (
              <p role="alert" className="text-sm text-destructive">
                {update.error.message}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/app/profile/role-preferences-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the card into `/profile`**

In `packages/web/app/profile/profile-editor.tsx`, add the import and render it right after `<WholeProfileUsage />`:

```tsx
'use client';

import { PER_DOCUMENT_CAP } from '@talenttrove/shared';
import { ResumeCard } from './resume-card.tsx';
import { RolePreferencesCard } from './role-preferences-card.tsx';
import { TextDocumentCard } from './text-document-card.tsx';
import { WholeProfileUsage } from './whole-profile-usage.tsx';

export function ProfileEditor() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <WholeProfileUsage />
      <RolePreferencesCard />
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

- [ ] **Step 6: Run the full web test suite once to confirm nothing else broke**

Run: `npx vitest run packages/web`
Expected: PASS (DB-backed suites SKIPPED unless `TEST_DATABASE_URL` is set).

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/profile/role-preferences-card.tsx packages/web/app/profile/role-preferences-card.test.tsx packages/web/app/profile/profile-editor.tsx
git commit -m "web: add roles/countries editor to /profile"
```

---

### Task 10: Remove the dead JSearch/Adzuna settings fields

**Files:**
- Modify: `packages/web/lib/settings-registry.ts`
- Modify: `packages/web/app/api/settings/route.test.ts`
- Modify: `packages/web/app/settings/settings-view.test.tsx`

**Interfaces:**
- Produces: `SettingKey`/`SETTINGS` with `jsearch_queries`, `jsearch_country`, `adzuna_countries`, `adzuna_queries` removed. `app/api/settings/route.ts` and `app/settings/settings-view.tsx` need no code changes — both already iterate `SETTINGS` generically.

- [ ] **Step 1: Update the tests that referenced the removed keys**

These tests use `jsearch_queries` purely as an example non-secret key to exercise generic GET/PUT behavior — swap it for `greenhouse_companies`, which stays in the registry and is also non-secret.

In `packages/web/app/api/settings/route.test.ts`:
- Replace every `delete process.env.JSEARCH_QUERIES;` with `delete process.env.GREENHOUSE_COMPANIES;`.
- In the `'GET reflects env-var fallback values and unset secrets'` test, replace `process.env.JSEARCH_QUERIES = 'staff engineer';` with `process.env.GREENHOUSE_COMPANIES = 'stripe:Stripe';`, and replace `body.items.find((item) => item.key === 'jsearch_queries')` with `body.items.find((item) => item.key === 'greenhouse_companies')`, and `expect(queries).toMatchObject({ value: 'staff engineer', ... })` with `expect(queries).toMatchObject({ value: 'stripe:Stripe', isSet: true, secret: false })`.
- In `'PUT saves a non-secret value...'`, replace `jsearch_queries: 'backend engineer'` with `greenhouse_companies: 'figma:Figma'` in the PUT body, and the follow-up `find((item) => item.key === 'jsearch_queries')?.value).toBe('backend engineer')` with `find((item) => item.key === 'greenhouse_companies')?.value).toBe('figma:Figma')`.
- In `'PUT with an empty string clears...'`, replace both `jsearch_queries: 'backend engineer'` / `jsearch_queries: ''` PUT bodies with `greenhouse_companies: 'figma:Figma'` / `greenhouse_companies: ''`, replace `process.env.JSEARCH_QUERIES = 'env fallback query';` with `process.env.GREENHOUSE_COMPANIES = 'env:Fallback';`, and the final assertion with `find((item) => item.key === 'greenhouse_companies')?.value).toBe('env:Fallback')`.
- In `'PUT returns 403...'`, replace `jsearch_queries: 'x'` with `greenhouse_companies: 'x:X'`.

In `packages/web/app/settings/settings-view.test.tsx`:
- Replace the `ITEMS` entry:
  ```ts
  const ITEMS = [
    { key: 'jsearch_api_key', label: 'JSearch API key', secret: true, value: null, isSet: false },
    {
      key: 'greenhouse_companies',
      label: 'Greenhouse companies (token:Display Name, comma-separated)',
      secret: false,
      value: 'stripe:Stripe',
      isSet: true,
    },
    { key: 'adzuna_app_id', label: 'Adzuna app ID', secret: true, value: null, isSet: true },
  ];
  ```
- In `'shows a loading state, then a section per adapter...'`, replace `screen.getByLabelText('JSearch search queries (comma-separated)')).toHaveValue('staff engineer')` with `screen.getByLabelText('Greenhouse companies (token:Display Name, comma-separated)')).toHaveValue('stripe:Stripe')`, and `await screen.findByText('JSearch')` stays (still asserting the JSearch section renders, now with only its API key field).
- In `'saves only the fields touched in a section'`, this test currently changes a JSearch-section field and clicks that section's Save — since `jsearch_queries` is gone, JSearch's only remaining field is its (secret) API key. Change the test to exercise the Greenhouse section instead:
  ```ts
  it('saves only the fields touched in a section', async () => {
    const doFetch = vi.fn((_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse({ items: ITEMS }));
      return Promise.resolve(jsonResponse({ items: ITEMS }));
    });
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SettingsView />);

    await screen.findByText('Greenhouse');
    fireEvent.change(screen.getByLabelText('Greenhouse companies (token:Display Name, comma-separated)'), {
      target: { value: 'figma:Figma' },
    });
    const greenhouseSection = screen.getByText('Greenhouse').closest('.rounded-lg') as HTMLElement;
    fireEvent.click(within(greenhouseSection).getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ greenhouse_companies: 'figma:Figma' }),
        }),
      ),
    );
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/web/app/api/settings/route.test.ts packages/web/app/settings/settings-view.test.tsx`
Expected: FAIL — `greenhouse_companies` assertions don't match what the current registry/route still serve alongside the not-yet-removed `jsearch_queries` etc.

Note: the `route.test.ts` suite is DB-backed (`describe.skipIf`) — if `TEST_DATABASE_URL` is unset it reports SKIPPED instead of FAIL; the `settings-view.test.tsx` suite is a plain component test (no DB) and will genuinely FAIL either way.

- [ ] **Step 3: Update the registry**

In `packages/web/lib/settings-registry.ts`, remove the four keys and their `SETTINGS` entries:

```ts
export type SettingKey =
  | 'jsearch_api_key'
  | 'adzuna_app_id'
  | 'adzuna_app_key'
  | 'greenhouse_companies'
  | 'lever_companies'
  | 'ashby_companies';

export type SettingConfig = { key: SettingKey; envVar: string; secret: boolean; label: string };

export const SETTINGS: SettingConfig[] = [
  { key: 'jsearch_api_key', envVar: 'JSEARCH_API_KEY', secret: true, label: 'JSearch API key' },
  { key: 'adzuna_app_id', envVar: 'ADZUNA_APP_ID', secret: true, label: 'Adzuna app ID' },
  { key: 'adzuna_app_key', envVar: 'ADZUNA_APP_KEY', secret: true, label: 'Adzuna app key' },
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

export type SettingItem = { key: SettingKey; label: string; secret: boolean; value: string | null; isSet: boolean };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/web/app/api/settings/route.test.ts packages/web/app/settings/settings-view.test.tsx`
Expected: PASS (`route.test.ts` PASS if `TEST_DATABASE_URL` is set, else SKIPPED; `settings-view.test.tsx` PASS unconditionally).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/settings-registry.ts packages/web/app/api/settings/route.test.ts packages/web/app/settings/settings-view.test.tsx
git commit -m "web: drop jsearch/adzuna query+country settings, superseded by per-account preferences"
```

---

### Task 11: Ingestion cron moves to daily

**Files:**
- Modify: `packages/web/vercel.json`

- [ ] **Step 1: Change the schedule**

```json
{
  "crons": [
    { "path": "/api/cron/ingest-postings", "schedule": "0 0 * * *" },
    { "path": "/api/cron/judge-postings", "schedule": "0 1,7,13,19 * * *" },
    { "path": "/api/cron/tailor-resumes", "schedule": "0 2,8,14,20 * * *" }
  ]
}
```

- [ ] **Step 2: Verify it's valid JSON**

Run (from `packages/web`): `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/vercel.json
git commit -m "web: move postings ingestion cron to once daily"
```

---

### Task 12: README updates

**Files:**
- Modify: `packages/web/README.md`

- [ ] **Step 1: Update the ingestion intro paragraph**

Find:

```
`postings` is populated by five independent source adapters
(`lib/ingestion/*.ts`), each reading its own environment variables. An
adapter with none of its variables set fetches nothing — this is not an
error, so you only need to configure the sources you actually want.
```

Replace with:

```
`postings` is populated by five independent source adapters
(`lib/ingestion/*.ts`). Greenhouse, Lever, and Ashby each read their own
environment variables (or `/settings`, see below) and fetch nothing when
unconfigured — this is not an error. JSearch and Adzuna are different:
they're driven by every account's own roles and countries, set at
`/profile` (see "Per-account role/country ingestion" below) — an instance
where no account has set any roles/countries yet gets nothing from these
two sources, same as an unconfigured adapter today.
```

- [ ] **Step 2: Update the JSearch/Adzuna bullets**

Find:

```
- **JSearch** (aggregator, sourced from Google for Jobs — covers Indeed/
  LinkedIn/Glassdoor listings indirectly): `JSEARCH_API_KEY` (a RapidAPI
  key for the [JSearch API](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch))
  and `JSEARCH_QUERIES`, a comma-separated list of search terms, e.g.
  `JSEARCH_QUERIES=staff software engineer,senior backend engineer`. One
  request is made per query. `JSEARCH_COUNTRY` (optional, a two-letter
  code, e.g. `us`) scopes every query to that country.
- **Adzuna** (a second aggregator, different coverage mix):
  `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` (from
  [developer.adzuna.com](https://developer.adzuna.com/)), plus
  `ADZUNA_COUNTRIES` (comma-separated two-letter codes, e.g. `us,gb`) and
  `ADZUNA_QUERIES` (comma-separated search terms). Queried once per
  country × query pair.
```

Replace with:

```
- **JSearch** (aggregator, sourced from Google for Jobs — covers Indeed/
  LinkedIn/Glassdoor listings indirectly): needs `JSEARCH_API_KEY` (a
  RapidAPI key for the
  [JSearch API](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)).
  Its search terms and countries are not configured here — they come from
  every account's own roles/countries (see "Per-account role/country
  ingestion" below).
- **Adzuna** (a second aggregator, different coverage mix): needs
  `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` (from
  [developer.adzuna.com](https://developer.adzuna.com/)). Like JSearch,
  its search terms and countries come from account roles/countries, not
  from env vars here.
```

- [ ] **Step 3: Add a new subsection after the adapter bullet list, before "All of the above can also be set..."**

Find the adapter bullet list's closing line (the Ashby/Greenhouse/Lever bullet ending in `GREENHOUSE_COMPANIES=stripe:Stripe,figma:Figma`.`), and insert this new subsection immediately after it, before the `All of the above can also be set from the running app at /settings` paragraph:

```
### Per-account role/country ingestion

Each signed-in account sets up to 5 roles and 3 countries at `/profile`
("Roles & countries"). JSearch and Adzuna are queried once per distinct
`(role, country)` pair across *every* account with both set — if two
accounts both want "staff software engineer" in "us", that's one API call
for that pair, not two. Countries are limited to the set
`lib/ingestion/adzuna-countries.ts` lists (Adzuna's supported codes, the
stricter of the two adapters). An account with no roles or no countries
set contributes nothing to these two sources, same as an ingestion
adapter with no config does today; postings from other accounts' pulls
are still visible to them through the normal shared `postings` search.
```

- [ ] **Step 4: Update the "set from `/settings`" paragraph's scope claim**

Find:

```
All of the above can also be set from the running app at `/settings`,
instead of editing these env vars — any signed-in account can view/edit
them there by default, since ingestion is a single instance-wide job, not
scoped per account (see `SETTINGS_ADMIN_EMAILS` below to restrict that). A
value saved from `/settings` overrides its matching env var here; clearing
it in the app (saving it blank) reverts to whatever's in the env var, if
anything. API keys saved from `/settings` are encrypted at rest before
being stored.
```

Replace with:

```
API keys and the Greenhouse/Lever/Ashby company lists can also be set from
the running app at `/settings`, instead of editing these env vars — any
signed-in account can view/edit them there by default (see
`SETTINGS_ADMIN_EMAILS` below to restrict that). These remain
instance-wide, unlike JSearch/Adzuna's roles/countries, which are set per
account at `/profile` (see above), not at `/settings`. A value saved from
`/settings` overrides its matching env var here; clearing it in the app
(saving it blank) reverts to whatever's in the env var, if anything. API
keys saved from `/settings` are encrypted at rest before being stored.
```

- [ ] **Step 5: Update the ingestion cron cadence line**

Find:

```
- **Scheduled**, via `POST /api/cron/ingest-postings`, which Vercel Cron
  calls on the `vercel.json` schedule (every 6 hours by default). This
  route requires `CRON_SECRET` to be set — without it, every call is
  refused with `401`, including Vercel's own.
```

Replace with:

```
- **Scheduled**, via `POST /api/cron/ingest-postings`, which Vercel Cron
  calls on the `vercel.json` schedule (once daily by default). This route
  requires `CRON_SECRET` to be set — without it, every call is refused
  with `401`, including Vercel's own.
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/README.md
git commit -m "docs: document per-account role/country ingestion"
```

---

### Task 13: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

Run: `npx tsc --noEmit` (from repo root, or per-package `tsc --noEmit -p packages/web/tsconfig.json` if the root has no umbrella config)
Expected: no errors.

- [ ] **Step 2: Run the full test suite without a test database**

Run: `npm test` (repo root)
Expected: all non-DB-backed tests (including every new test from Tasks 2, 5, 6, 8's exercise via Task 9, 9, 10) PASS; DB-backed suites (Tasks 1, 3, 4, 7, and existing ones) report SKIPPED.

- [ ] **Step 3: Run the full test suite against a real Postgres at least once**

Set `TEST_DATABASE_URL` to a real (local/disposable) Postgres connection string, then run: `npm test` (repo root)
Expected: every DB-backed suite touched by this plan (Tasks 1, 3, 4, 7, and the pre-existing suites in `packages/web`) PASSES, not SKIPPED — per this repo's own README, a SKIPPED result is not evidence the DB-backed code works.

- [ ] **Step 4: Manually exercise the ingestion adapters against the new pair source (optional but recommended)**

With `DATABASE_URL` pointed at a real Postgres that has at least one account with roles/countries saved (via `/profile` or a direct `setUserPreferences` call) and `JSEARCH_API_KEY`/`ADZUNA_APP_ID`/`ADZUNA_APP_KEY` set, run: `npm run db:ingest -w packages/web`
Expected: the printed `IngestionSummary` shows non-zero `fetched`/`upserted` for `jsearch`/`adzuna` (network permitting) and the postings table gains rows sourced from the account's roles/countries.

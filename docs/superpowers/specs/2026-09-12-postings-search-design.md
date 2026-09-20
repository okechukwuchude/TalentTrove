# Job postings ingestion and search

Status: approved design, pending spec review
Date: 2026-09-12

## Why

`2026-09-11-tabs-rebuild-design.md` shipped `postings` as an empty,
schema-only table — tabs needed something to reference but explicitly left
"job postings search, scraping, ranking, or any populating of `postings`
beyond the dev seed script" for its own spec, next. This is that spec.

`/api/search` and `/api/companies` have been `501` since
`2026-09-09-auth-database-foundation-design.md` retired the hosted
`api.talenttrove.ai` backend they used to proxy to. This piece replaces that
backend function entirely: a self-hosted ingestion pipeline that populates
`postings` from real sources, and word/filter search over Postgres against
what it collects.

**Explicitly not in scope for this piece:** judge (screening/ranking
postings against a resume with an LLM). That was considered as part of this
same pass and deliberately deferred — it is a separate, already-anticipated
subsystem in this codebase (`DEFAULT_JUDGE_PROMPT`, `verdicts.ts`, judge
quota/allowance in `packages/shared/src/limits.ts`), and it needs real
postings to exist before it has anything to screen. It is the next spec
after this one, not part of it.

**On LinkedIn and Indeed specifically:** neither offers a public API for a
personal tool like this to pull listings from, and both prohibit scraping
in their terms of service (LinkedIn has pursued litigation over this —
*hiQ Labs v. LinkedIn*). This spec does not attempt to scrape either site.
Instead it pulls from sources that are either explicitly public/licensed
for this use or offer no barrier to reading at all:

- **JSearch** (via RapidAPI) — an aggregator sourced from Google for Jobs,
  which itself indexes Indeed, LinkedIn, Glassdoor and many company sites.
  This is how postings that originated on those sites reach this app
  without this app touching either site directly.
- **Adzuna** — a second aggregator API, different coverage mix, same shape
  of integration.
- **Greenhouse / Lever / Ashby**, direct — these three applicant-tracking
  systems publish their customers' open listings as plain public JSON APIs
  with no key required (e.g. `boards-api.greenhouse.io/v1/boards/<token>/jobs`).
  Scoped to a list of companies this account names.

This is a personal/single-user setup (same framing as the auth and tabs
specs) — there is no scraping-at-scale problem to solve, no rate-limit
concern beyond each API's own free-tier caps, and no per-user postings
visibility to design for. Postings are one shared, global table, same as
tabs' design already assumed.

## Sources & normalization

One adapter module per source under `packages/web/lib/ingestion/`, each
implementing the same shape:

```ts
export type RawPosting = {
  title: string;
  company: string;
  locations?: string[];
  country?: string;
  workplace?: 'remote' | 'hybrid' | 'onsite' | null;
  employment?: 'full-time' | 'part-time' | 'contract' | 'internship' | null;
  postedAt?: Date | null;
  url: string;
  source: string; // 'jsearch' | 'adzuna' | 'greenhouse' | 'lever' | 'ashby'
};

export type IngestionAdapter = {
  name: string;
  fetchPostings(): Promise<RawPosting[]>;
};
```

- **`lib/ingestion/jsearch.ts`** — queries `JSEARCH_QUERIES` (a configured
  list of search terms, e.g. `"staff software engineer"`, one request per
  term) against RapidAPI's JSearch endpoint using `JSEARCH_API_KEY`.
- **`lib/ingestion/adzuna.ts`** — same query-list approach against Adzuna's
  `/jobs/<country>/search` endpoint using `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`.
- **`lib/ingestion/greenhouse.ts`**, **`lever.ts`**, **`ashby.ts`** — each
  takes a comma-separated list of company board tokens from an env var
  (`GREENHOUSE_COMPANIES`, `LEVER_COMPANIES`, `ASHBY_COMPANIES`) and fetches
  every listed company's public jobs endpoint. No key needed. An unset or
  empty env var means that adapter fetches nothing — it is not an error, it
  just isn't configured yet.

**Each adapter owns mapping its source's vocabulary onto the two enums the
existing `SearchFilters` UI already hardcodes** (`workplace`:
`remote|hybrid|onsite`, `employment`: `full-time|part-time|contract|internship`)
— a value the adapter can't confidently map becomes `null`/omitted rather
than guessed. `country` is parsed from whatever location data the source
provides (RapidAPI/Adzuna return structured location fields; Greenhouse/
Lever/Ashby's postings are scoped to companies whose location is generally
known ahead of time, or left `null` when genuinely unclear).

**A source's own request/response shape lives entirely inside its adapter
file.** Nothing outside `lib/ingestion/` knows or cares that JSearch's
response nests a job's title under `job_title` while Adzuna calls it
`title` — `run-ingestion.ts` and everything downstream only ever sees
`RawPosting`.

## Schema changes

Two additions to the existing `postings` table (new migration on top of
`0002_*`, no data loss):

```ts
export const postings = pgTable('postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  locations: text('locations').array(),
  country: text('country'),                    // new
  workplace: text('workplace'),
  employment: text('employment'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  url: text('url').notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('postings_url_key').on(table.url),  // new
]);
```

- **`country`** — a normalized column separate from the free-text
  `locations` array used for display; search filters on this, not on
  parsing `locations` at query time.
- **`postings_url_key`** — the dedup key. The same listing reappearing in a
  later ingestion run (JSearch/Adzuna return recently-posted results on
  every run, not just new ones) updates the existing row via
  `ON CONFLICT (url) DO UPDATE`, rather than inserting a duplicate.

**No new `companies` table.** `GET /api/companies` derives distinct
companies straight from `postings.company`, grouping and counting:

```sql
select company, count(*)::int as posting_count
from postings
where company ilike '%' || $1 || '%'
group by company
order by posting_count desc
limit 10
```

with **the company name itself standing in as its `id`** — the frontend's
`CompanyCombobox` already treats `id` opaquely (`{id, name}`), so this needs
no frontend change. The `company` search filter is then a plain `= ANY(...)`
match against `postings.company` using those same name strings. This trades
away de-duplicating spelling variants across sources (`"Google"` vs
`"Google LLC"`) for not building or maintaining a real company-identity
table before anything has demonstrated that variance is actually a problem
in practice. If it does become one, `GET /api/companies`'s response shape
(`{id, name, posting_count}`) does not need to change to fix it — `id` would
just stop being literally the name.

## Ingestion pipeline

- **`packages/web/lib/ingestion/run-ingestion.ts`** exports
  `runIngestion(): Promise<{source: string; fetched: number; upserted: number; failed: string | null}[]>`
  — calls every configured adapter (skipping ones with no credentials/company
  list set), upserts each adapter's `RawPosting[]` into `postings` by `url`,
  and never lets one adapter's failure stop the others: each adapter's
  fetch is wrapped so a thrown error becomes that adapter's `failed` message
  in the returned summary rather than an unhandled rejection.
- **`GET /api/cron/ingest-postings`** — the route Vercel Cron calls. Reads
  the `Authorization: Bearer <token>` header and compares it to
  `process.env.CRON_SECRET` (Vercel's own convention for cron-triggered
  routes — see "Securing cron jobs" in Vercel's docs) using
  `crypto.timingSafeEqual`; a mismatch or missing header returns `401`
  before `runIngestion` is ever called. On success, returns the per-adapter
  summary as JSON (useful for checking the Vercel function log after a run).
- **`packages/web/vercel.json`** gets a `crons` entry running every 6 hours:
  ```json
  { "crons": [{ "path": "/api/cron/ingest-postings", "schedule": "0 */6 * * *" }] }
  ```
- **`npm run db:ingest`** (`packages/web/package.json`, alongside the
  existing `db:seed`) runs `runIngestion()` directly against `DATABASE_URL`
  for manual/local runs — same `tsx`-script pattern as `seed-postings.ts`.

## Endpoints

Both replace their current `501` stub bodies; the `requireSession` 401
guard already in each stays as the first check, unchanged.

- **`POST /api/search`** — body `{q?, country?, workplace?, employment?, posted_after?, company?, unjudged?, limit?, cursor?}`,
  matching `lib/search-queries.ts`'s existing wire shape exactly (no
  frontend change needed). `company` is a comma-separated list of company
  names (from `CompanyCombobox`'s selections). Behavior:
  - With `q`: full-text search via
    `to_tsvector('english', title || ' ' || company) @@ plainto_tsquery('english', $q)`,
    ordered by `ts_rank(...)` descending.
  - Without `q`: ordered by `posted_at desc nulls last`.
  - `workplace`/`employment`/`company` are exact-match `WHERE` clauses
    (`company` via `= ANY(...)`, both sides coming from `postings.company`'s
    own stored values since the combobox only ever suggests names that
    already exist there). `country` is free text with no autocomplete on
    the frontend, unlike `company` — matched case-insensitively with
    `country ilike $country` rather than exact equality, so typing `usa`
    against a stored `USA` still matches without requiring the user to
    guess the exact ingested spelling. `posted_after` is `posted_at >= $date`.
  - **`unjudged` is accepted but has no effect yet** — there is no
    judgments table until judge ships, so every posting is currently
    "unjudged" by definition. This is called out in the route's own code
    comment, not silently ignored without explanation.
  - Cursor pagination follows `getTabContents`'s existing pattern in
    `tabs-db.ts`: an opaque base64url cursor encoding the last row's sort
    key (rank or `posted_at`) plus `id` as a tiebreaker.
  - Returns `{rows: PostingJson[], cursor: string | null}` — no
    `interpretation` field. `SearchView`'s `coveragePrefix` already renders
    nothing when `interpretation` is absent, and this endpoint has no
    ceiling/dropped-postings concept yet to report — fabricating a
    covered/total pair with nothing behind it would be worse than omitting
    it. (`coverageOf` from `@talenttrove/shared` is not used here for that
    reason; it has nothing meaningful to compute yet.)
  - No confirm-gate: reading your own postings costs nothing and isn't
    unattended automation, unlike judge.
- **`GET /api/companies?q=`** — `{rows: {id, name, posting_count}[]}` per
  the query above. `q` shorter than 2 characters returns `{rows: []}`
  without querying (mirrors `useCompanies`'s existing `enabled` guard on the
  frontend, so an empty/near-empty query never round-trips for nothing).

## Error handling

Same convention as every other route in this codebase: malformed/missing
JSON body → `400 {error: string}`. Search takes no user-owned resource by
name, so there is no `404` case to define here. The one new failure mode is
the cron route's auth check: missing/wrong `CRON_SECRET` → `401`, logged
server-side (not surfaced to whoever/whatever sent the request) since a
stranger hitting this route by guessing the path is expected background
noise on the public internet, not an incident.

## Testing

- **Adapter tests** (`lib/ingestion/*.test.ts`), no database needed: mock
  `fetch` with a captured real-shaped response fixture per source, assert
  the raw→`RawPosting` mapping (including the workplace/employment enum
  mapping and the "can't confidently map, omit rather than guess" case).
- **`run-ingestion.ts` test**: one adapter's fetch throws, assert the other
  adapters' results still come through and the failing one's `failed`
  message is populated rather than the whole run throwing.
- **`lib/postings-search.ts` test**, gated on `TEST_DATABASE_URL` (same
  `describe.skipIf` convention as `tabs-db.test.ts`): filter combinations,
  cursor pagination, word-search ranking with a handful of seeded rows, and
  the `url` upsert-not-duplicate behavior.
- **Route tests** for `/api/search` and `/api/companies`, extending the
  existing 401/501 stub tests to real 400/200 behavior, following
  `app/api/tabs/route.test.ts`'s pattern.
- **Cron route test**: 401 with no/wrong `Authorization` header, 200 with
  the correct `CRON_SECRET`, using `timingSafeEqual`'s real code path (not
  mocked) since this is security-relevant code.
- No frontend test changes expected — `search-filters.test.tsx`,
  `search-view.test.tsx`, and `company-combobox.test.tsx` already assert
  the exact request/response shapes this spec produces.

## Migration/rollout note

Same as the auth and tabs pieces: this is developed and used by one person,
so there is no live traffic to protect. `postings` currently holds only
seed-script rows (`source = 'seed'`); this ships alongside those unaffected
— real ingestion rows simply start appearing next to them. The dev seed
script (`db:seed`) stays as-is for local testing without needing live API
keys configured.

**New environment variables**, all optional per-adapter (an unconfigured
adapter just fetches nothing, per "Sources & normalization" above):
`JSEARCH_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `GREENHOUSE_COMPANIES`,
`LEVER_COMPANIES`, `ASHBY_COMPANIES`, plus `CRON_SECRET` (required for the
cron route itself to accept any request at all).

## Out of scope for this design

- Judge (LLM screening/ranking postings against a resume) — the next spec,
  built on top of real postings existing.
- A real `companies` table with cross-source identity resolution.
- A manual "add a posting by URL" UI.
- Per-user postings visibility or per-user ingestion sources — postings
  stay one shared/global table, matching tabs' existing design.
- Semantic (embedding-based) search — out of scope until judge exists to
  give it a reason to (embeddings are judge's territory: matching a
  resume's meaning against a posting's, not matching search words).

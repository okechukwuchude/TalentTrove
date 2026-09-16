# Per-user roles + countries drive postings ingestion, replacing instance-wide queries

Status: approved design, pending spec review
Date: 2026-09-16

## Why

Postings ingestion (`lib/ingestion/*.ts`) currently pulls from JSearch and
Adzuna using a fixed set of search queries and country codes, configured
once for the whole instance — either via env vars or via `/settings`
(`docs/superpowers/specs/2026-09-15-ingestion-settings-design.md`). Every
account sees postings from the same admin-chosen queries, whether or not
those queries match what that account is actually looking for.

The user wants each account to set the roles and countries *they* care
about (alongside uploading their CV, which already exists at `/profile`),
and have ingestion pull postings for those roles/countries specifically —
this is the CV-upload-to-apply loop the user described end to end,
of which ingestion was the one instance-wide piece.

This explicitly reverses a decision recorded in the ingestion-settings
design ("Per-user ingestion config — `postings` is global; this whole
feature is necessarily instance-wide, not account-scoped"). That was true
of the settings-page mechanism it described; this design changes what
feeds JSearch's and Adzuna's queries, not `postings` itself, which stays
global and shared (see "What already exists" below).

Greenhouse/Lever/Ashby (direct company-board pulls) have no query concept
— there is nothing to make "per-role" about fetching every posting from a
company's own board — so they stay exactly as they are today, instance-wide
and admin-configured.

## What already exists and must not be redesigned

- **`postings` table** — stays global, shared, deduped by `url`. Ingestion
  becomes per-user *query-driven*, not per-user *storage*. A posting
  fetched because one account wanted "staff software engineer in ca" is
  visible to every account's search, exactly like today.
- **`lib/ingestion/run-ingestion.ts`** — unchanged. It still just calls
  `adapter.fetchPostings()` per adapter and upserts whatever comes back;
  it doesn't know or care where an adapter's queries came from.
- **`lib/ingestion/greenhouse.ts` / `lever.ts` / `ashby.ts`** —
  unchanged, stay reading `/settings`-or-env company lists.
- **Judging, tailoring, apply** (`lib/judging/`, `lib/tailoring/`,
  `/apply`) — entirely unchanged. They already work per-account against
  the shared `postings` pool via `constraints`/`background`/`preferences`/
  `resume` and, optionally, routines. Nothing about how a posting got
  ingested matters to them.
- **`routines`** — unchanged, stays a separate, more advanced mechanism
  (custom judge prompt, destination tab, arbitrary search filter). Roles/
  countries is a simpler, lower-ceiling setting that drives *ingestion*;
  routines drive *judging*. An account can have both, or neither.
- **`lib/settings-db.ts`'s `getSetting`/`getSecretSetting`/`setSetting`
  pattern** — not reused for this data. Roles/countries are per-user, not
  instance-wide, so they belong in a real per-user table, not
  `app_settings` (which is keyed by a global string, no `userId`).

## Data model

New table, one row per user (separate from `users`, per discussion — keeps
auth-focused `users` minimal and matches the existing
`profileDocuments`-keyed-by-`userId` precedent):

```ts
// db/schema.ts
export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  roles: text('roles').array(),
  countries: text('countries').array(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- `roles`: up to 5 free-text strings (e.g. `"staff software engineer"`),
  same shape/spirit as today's comma-separated `JSEARCH_QUERIES`/
  `ADZUNA_QUERIES`, just per-user and stored as a real array instead of a
  joined string.
- `countries`: up to 3 two-letter codes. Constrained (see "Country
  validation" below) to the codes Adzuna actually supports, since Adzuna
  is the stricter of the two per-user-driven adapters — a country Adzuna
  can't query would silently contribute nothing from that adapter, which
  is worth preventing at input time rather than discovering later.
- No row for a user who hasn't set preferences yet — same "absence means
  nothing configured" convention `profileDocuments` and `app_settings`
  already use. That account's roles/countries simply don't contribute any
  queries; they still see whatever the shared pool has from other users.

### Country validation

`lib/ingestion/adzuna-countries.ts` (new): a constant list of Adzuna's
supported two-letter country codes — single source of truth used by (a)
the `/profile` country multi-select's options and (b) the
`user_preferences` write path's validation, so the two can never drift
apart.

## Ingestion changes

`lib/ingestion/jsearch.ts` and `lib/ingestion/adzuna.ts` stop reading
`jsearch_queries`/`jsearch_country`/`adzuna_countries`/`adzuna_queries`
(DB-or-env) entirely. Instead, both call a new
`lib/ingestion/user-query-pairs.ts`:

```ts
export type QueryPair = { role: string; country: string };

// SELECT DISTINCT unnest(roles) AS role, unnest(countries) AS country
// FROM user_preferences WHERE roles IS NOT NULL AND countries IS NOT NULL
export async function loadDistinctQueryPairs(): Promise<QueryPair[]>;
```

Distinct across *all* users, not per-user — if fifty accounts all want
"staff software engineer" in "us", that's one JSearch call and one Adzuna
call for that pair, not fifty. This keeps the API-call volume bounded by
the number of *distinct* (role, country) combinations in use, not the
number of users, which is the only way per-user targeting stays viable at
more than a handful of accounts.

- **`jsearch.ts`**: today applies one global country (or none) to every
  query. It changes to loop over `(role, country)` pairs, adding
  `&country=` per call the same way `adzuna.ts` already does — this makes
  the two adapters' looping structure identical.
- **`adzuna.ts`**: already loops `countries × queries`; changes to loop
  over the pair list directly instead of the cross product of two
  separately-configured arrays. Functionally the same shape of loop, just
  fed distinct pairs instead of `countries.flatMap(c => queries.map(q =>
  [c, q]))`.
- An account with **no** `user_preferences` row contributes zero pairs, so
  an instance with nobody having set roles/countries yet runs these two
  adapters with an empty pair list — same observable behavior as
  "unconfigured" does today (`fetchPostings()` returns `[]`).
- `jsearch_api_key`/`adzuna_app_id`/`adzuna_app_key` (the secrets) are
  unaffected — still DB-or-env, still instance-wide, since an API key is a
  deployment credential, not a per-user preference.

`/settings` and `README.md`'s "Configuring postings ingestion" section
lose the `jsearch_queries`/`jsearch_country`/`adzuna_countries`/
`adzuna_queries` fields/env vars (superseded); the API-key fields and the
Greenhouse/Lever/Ashby company-list fields stay exactly as they are.

## Cron cadence

`vercel.json`'s ingestion schedule moves from every 6 hours to once daily:

```json
{ "path": "/api/cron/ingest-postings", "schedule": "0 0 * * *" },
{ "path": "/api/cron/judge-postings", "schedule": "0 1,7,13,19 * * *" },
{ "path": "/api/cron/tailor-resumes", "schedule": "0 2,8,14,20 * * *" }
```

Judge/tailor keep their existing four-times-daily cadence and relative
offsets — they process whatever's new in the shared pool since their last
run, which now grows once a day instead of four times a day, but nothing
about how they run needs to change.

## `/profile` UX

Two new fields added to `profile-editor.tsx`, alongside the existing
resume upload (not a new route — decided over a dedicated onboarding
flow):

- **Roles** — a tag/chip input. Add up to 5 free-text strings; each
  removable individually. Empty state explains what it's for ("Job titles
  we'll search for on your behalf, e.g. \"senior backend engineer\"").
- **Countries** — a multi-select limited to `adzuna-countries.ts`'s list.
  Add up to 3.

Both save via a new API route (below); validation errors (cap exceeded,
unsupported country code) render inline the same way `profile-editor.tsx`
already surfaces document-save errors from `/api/profile`.

## API

New `lib/user-preferences-db.ts`, mirroring `lib/profile-db.ts`'s shape:

```ts
export async function getUserPreferences(userId: string): Promise<{ roles: string[]; countries: string[] } | null>;
export async function setUserPreferences(userId: string, roles: string[], countries: string[]): Promise<void>;
```

New `app/api/user-preferences/route.ts`:

- **`GET`** — returns the signed-in account's `{ roles, countries }` (`{
  roles: [], countries: [] }` when no row exists — the form always has
  something to render). Gated by `requireSession`, same 401 shape as every
  other authenticated route.
- **`PUT`** — body `{ roles: string[], countries: string[] }`. Validates:
  `roles.length <= 5`, each non-empty after trim; `countries.length <= 3`,
  each present in `adzuna-countries.ts`'s list. `400` with a plain message
  on violation (matching `/api/profile`'s existing validation-error
  shape), `200` with the saved values on success. Upserts the single row
  (`ON CONFLICT (user_id) DO UPDATE`), so first save and subsequent edits
  are the same call.

## Error handling

`loadDistinctQueryPairs()`'s DB read happens inside `fetchPostings()`,
which — like every adapter today — has no special try/catch of its own; a
failure propagates to `run-ingestion.ts`'s existing per-adapter try/catch
(logged, that adapter's summary shows `failed`, other adapters still run).
No new error-handling surface, consistent with how the settings-DB reads
this replaces already behave.

## Testing

- **`user-preferences-db.test.ts`**: `getUserPreferences` returns `null`
  for a user with no row; `setUserPreferences` then `get` round-trips;
  a second `setUserPreferences` call overwrites rather than duplicating
  (upsert, not insert).
- **`adzuna-countries.test.ts`**: the list is non-empty and every entry is
  a lowercase two-letter code (guards against a typo silently adding a bad
  option to the form).
- **`app/api/user-preferences/route.test.ts`**: 401 signed out; GET
  reflects empty defaults then a saved value; PUT rejects a 6th role and
  a 4th country (`400`); PUT rejects a country not in
  `adzuna-countries.ts` (`400`); PUT with valid input round-trips via a
  follow-up GET.
- **`user-query-pairs.test.ts`**: no rows → `[]`; two users sharing one
  `(role, country)` pair → that pair appears once; users with different
  pairs → all distinct pairs appear; a user with `roles` set but
  `countries` null (or vice versa) contributes no pairs.
- **`jsearch.test.ts` / `adzuna.test.ts`**: replace the existing
  queries/country-config tests with cases driven by `loadDistinctQueryPairs()`
  (mocked) — one call per pair, `country` param set correctly per call;
  empty pair list → `[]`, no fetch calls made.
- **`profile-editor.tsx` component test**: renders roles/countries
  sections; adding a 6th role is blocked in the UI; submitting issues the
  expected `PUT /api/user-preferences` payload; a `400` response renders
  the server's message inline.

## Migration/rollout note

Personal/single-user, no live traffic to protect, consistent with every
prior piece in this app. `user_preferences` is a new table with nothing to
backfill — every existing account simply has no row until they visit
`/profile` and set roles/countries, during which ingestion for
JSearch/Adzuna contributes nothing (same as an entirely unconfigured
instance today) until at least one account has saved preferences.

`README.md`'s "Configuring postings ingestion" section is updated to
describe JSearch/Adzuna as per-user (driven from each account's
`/profile`), remove the now-dead env vars/settings fields for their
queries/countries, and keep the API-key and Greenhouse/Lever/Ashby
sections unchanged.

## Out of scope for this design

- Per-user ingestion for Greenhouse/Lever/Ashby — these fetch a company's
  entire board, not a query; there is nothing role-shaped to filter at
  fetch time. (A posting from an admin-configured company board is still
  visible to every account via the shared `postings` pool and can still be
  judged against their profile/routines exactly as today.)
- Any per-user rate limiting or cost accounting beyond the pair-dedup
  described above (e.g. a "your queries used N of your account's API
  budget" concept) — out of scope until real usage shows the dedup alone
  isn't enough.
- Migrating existing `routines` filters into `roles`/`countries`, or vice
  versa — they remain two independent, coexisting mechanisms.
- Raising the 5-role / 3-country caps, or making them configurable — fixed
  constants for now; revisit if real usage shows they're too tight.

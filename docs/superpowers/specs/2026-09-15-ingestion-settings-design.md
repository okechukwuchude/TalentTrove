# Ingestion settings: configure postings sources from the app, not `.env`

Status: approved design, pending spec review
Date: 2026-09-15

## Why

Postings ingestion (`lib/ingestion/*.ts`) reads every adapter's
configuration — API keys, search queries, country codes, company board
lists — from environment variables. Changing which roles get searched for,
or adding a company to the Greenhouse list, currently means editing
`.env.local` (or the Vercel project's env vars) and redeploying/restarting.
The user wants to set JSearch's queries and country, and by extension every
adapter's equivalent config, from inside the running app instead.

`postings` has no `userId` column — ingestion is a single global cron job
shared by every account, not a per-account concern (see `db/schema.ts`).
So this is an instance-level settings screen, not a per-user preference,
and there is no existing roles/admin concept to gate it with — every
signed-in account can already see and act on shared state elsewhere in this
app (all postings, for instance), so this follows the same precedent:
any signed-in user can view and edit ingestion settings.

## What already exists and must not be redesigned

- **`lib/ingestion/{jsearch,adzuna,greenhouse,lever,ashby}.ts`** — each
  adapter's `fetchPostings()` request-building and response-mapping logic
  is unchanged. Only *where the config values come from* changes.
- **`lib/ingestion/types.ts`'s `IngestionAdapter` type** — unchanged;
  `fetchPostings(): Promise<RawPosting[]>` already returns a promise, so
  adapters doing an extra `await` to read settings is not a shape change.
- **`lib/ingestion/run-ingestion.ts`** — unchanged; it already just calls
  `adapter.fetchPostings()` per adapter and doesn't know or care what's
  inside.
- **`lib/require-session.ts`** — reused unchanged as the auth gate for the
  new settings page/route, the same way every other authenticated page
  gates itself.
- **`lib/passwords.ts`** — deliberately *not* reused. Password hashing is
  one-way; API keys must be recovered in plaintext to call external APIs,
  so they need reversible encryption, not hashing. This is new territory
  for this repo (see "Secrets" below).

## Data model

One generic key-value table, not a bespoke column per adapter field —
adapters' config is a handful of short strings/lists each, and a
key-value shape means adding a field to an adapter later never needs a
migration:

```ts
// db/schema.ts
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // plaintext for non-secret keys; ciphertext (see below) for secret keys
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Keys, one per existing env var this replaces:

| key | secret? | shape |
|---|---|---|
| `jsearch_api_key` | yes | single string |
| `jsearch_queries` | no | comma-separated |
| `jsearch_country` | no | single two-letter code (new — see below) |
| `adzuna_app_id` | yes | single string |
| `adzuna_app_key` | yes | single string |
| `adzuna_countries` | no | comma-separated two-letter codes |
| `adzuna_queries` | no | comma-separated |
| `greenhouse_companies` | no | comma-separated `token:Display Name` |
| `lever_companies` | no | comma-separated `token:Display Name` |
| `ashby_companies` | no | comma-separated `token:Display Name` |

A row only exists once someone saves that field from the settings page;
an unset key means "fall through to the env var" (see "Reading config"
below), so shipping this needs no data migration/backfill.

**`jsearch_country` is new** — `jsearch.ts` doesn't take a country today,
unlike Adzuna. The JSearch API accepts an optional `country` query
param to scope results the same way Adzuna already does per-country; the
adapter adds `&country=` to its request URL when a country is configured,
omitted otherwise (matching today's exact behavior when unset).

## Secrets

No encryption helper exists in this repo yet (`lib/passwords.ts` hashes
one-way; sessions/tokens use `sha256` for lookup, also one-way). New
`lib/settings-crypto.ts`:

```ts
export function encryptSecret(plaintext: string): string; // -> base64(iv):base64(authTag):base64(ciphertext)
export function decryptSecret(stored: string): string;
```

AES-256-GCM, key derived from `SESSION_SECRET` via `scryptSync` (a fixed
salt specific to this purpose, e.g. `'pinloop-settings-v1'`, is fine here —
`SESSION_SECRET` itself is the actual secret input, unique per deployment
and already required to be high-entropy; the salt only needs to prevent
the derived key from colliding with some other `scryptSync(SESSION_SECRET,
…)` use elsewhere, not to add entropy of its own). No new required env
var — every deployment already has `SESSION_SECRET`.

## Reading config: DB overrides env

New `lib/settings-db.ts`:

```ts
export async function getSetting(key: string): Promise<string | null>;
export async function getSecretSetting(key: string): Promise<string | null>; // decrypts
export async function setSetting(key: string, value: string): Promise<void>;
export async function setSecretSetting(key: string, value: string): Promise<void>; // encrypts
export async function clearSetting(key: string): Promise<void>; // deletes the row, reverting to env fallback
```

Each adapter changes its config reads from `process.env.X` to:

```ts
const queries = (await getSetting('jsearch_queries')) ?? process.env.JSEARCH_QUERIES;
```

DB wins when a row exists; the env var is the fallback when it doesn't —
so an existing deployment that has never touched the settings page keeps
working exactly as today, and saving a field from the UI is the only way
its env-var equivalent stops being read. Clearing a field in the UI
deletes the row (not "save empty string") so the env var fallback comes
back rather than being permanently shadowed by an empty value.

## Settings page and API

- **`GET /api/settings`** — returns every key's current *non-secret*
  value (DB value if set, else the env var, so the form always shows
  what's actually in effect) and, for secret keys, only a boolean
  (`jsearchApiKeySet: true/false` — sourced from DB-or-env, same
  "what's actually in effect" logic) — never the key itself, matching how
  a password field never round-trips a stored password back to the
  client.
- **`PUT /api/settings`** — body is a partial map of `{ key: value }`.
  Secret keys are encrypted before storing; a secret key present with an
  empty string clears it (reverts to env fallback) rather than storing an
  empty ciphertext. Gated by `requireSession`, same 401 shape as every
  other authenticated route.
- **`app/settings/page.tsx`** — one form, sectioned by adapter (JSearch /
  Adzuna / Greenhouse / Lever / Ashby), each field labeled with what it
  does (reusing the wording already in `README.md`'s "Configuring postings
  ingestion" section). Secret fields render as password-style inputs
  showing only "already set" / "not set", with a way to replace but not
  reveal them — this app has no existing form component for a
  write-only/masked field, so this adds one (`components/ui/secret-field.tsx`
  or similar; exact naming is an implementation-plan decision).

## Error handling

`getSetting`/`getSecretSetting` reads happen inline in each adapter's
`fetchPostings()`, which already returns `[]` (no throw) when required
config is missing — that behavior is unchanged, it just now also checks
the DB first. A DB read failure here (e.g. connection error) is not
specially caught — it propagates like any other unexpected error in
`fetchPostings()`, which `run-ingestion.ts`'s existing per-adapter
try/catch already handles (logged, that adapter's summary gets
`failed`, other adapters still run). No new error-handling surface is
introduced.

## Testing

- **`settings-crypto.test.ts`**: encrypt/decrypt round-trips to the
  original plaintext; two calls with the same plaintext produce different
  ciphertext (random IV per call); decrypting a tampered ciphertext throws
  (GCM auth-tag check).
- **`settings-db.test.ts`**: `getSetting`/`getSecretSetting` return `null`
  when unset; `setSetting`/`setSecretSetting` then `get*` round-trips;
  `clearSetting` removes the row.
- **Each adapter's existing `.test.ts`**: extend with a case where the DB
  has a value and the env var is *also* set to something different —
  assert the DB value wins (covers the override, not just the fallback,
  which the existing "unconfigured → `[]`" tests already exercise via env
  vars alone).
- **`jsearch.test.ts`**: new case for `jsearch_country` being appended to
  the request URL when set, omitted when not.
- **`app/api/settings/route.test.ts`**: 401 when signed out; GET reflects
  DB-or-env "what's in effect" plus secret booleans; PUT saves and a
  follow-up GET reflects it; PUT with an empty string on a secret key
  clears it (subsequent GET's boolean flips back to reflecting the env
  fallback).
- **`app/settings/page.tsx` component test**: renders all adapter
  sections; submitting a field's form section issues the expected `PUT`
  payload; a secret field shows "set"/"not set" rather than a value.

## Migration/rollout note

Personal/single-user, no live traffic to protect, consistent with every
prior piece. `app_settings` is a new table with nothing to backfill, and
its introduction is behavior-neutral for every existing deployment until
someone actually saves a field on the settings page (see "Reading config"
above) — `.env.local`/Vercel env vars keep working exactly as they do
today for anyone who never visits it.

`README.md`'s "Configuring postings ingestion" section gets a short
addition noting these are now also settable from `/settings` in the
running app, with the DB-overrides-env precedence stated explicitly — the
existing env var documentation itself stays accurate and is not removed,
since the env vars remain a real (fallback) configuration path.

## Out of scope for this design

- Storing API keys anywhere other than this app's own database — no
  third-party secrets manager integration.
- A "test connection" / validate-before-save button for API keys — save
  and let the next ingestion run surface a failure the same way a bad env
  var does today (logged, that adapter's summary shows `failed`).
- Per-user ingestion config — `postings` is global; this whole feature is
  necessarily instance-wide, not account-scoped.
- Any role/admin restriction narrower than "any signed-in user" — this
  app has no roles concept today and one is not being introduced for this
  feature alone.
- Removing the env var path entirely — DB overrides env, it does not
  replace it (explicitly decided with the user).

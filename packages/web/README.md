# @talenttrove/web

## Local setup

Environment variables (e.g. in `packages/web/.env.local`):

- `SESSION_SECRET` — any string of at least 32 characters.
- `DATABASE_URL` — a Postgres connection string.
- `APP_ORIGIN` — the app's own public URL, used to build password-reset
  links safely (falls back to the request's own origin outside production,
  but is required in production).
- `RESEND_API_KEY` — needed only for the "forgot password" email; sign-in,
  sign-up, and everything else work without it.
- `PASSWORD_RESET_FROM_EMAIL` — optional; defaults to Resend's own test
  sender address if unset.

Postings ingestion needs its own set of variables — see "Configuring
postings ingestion" below. All of them are optional; the app runs fine
with none of them set, it just won't have any real postings to search.

## Configuring postings ingestion

`postings` is populated by five independent source adapters
(`lib/ingestion/*.ts`). Greenhouse, Lever, and Ashby each read their own
environment variables (or `/settings`, see below) and fetch nothing when
unconfigured — this is not an error. JSearch and Adzuna are different:
they're driven by every account's own roles and countries, set at
`/profile` (see "Per-account role/country ingestion" below) — an instance
where no account has set any roles/countries yet gets nothing from these
two sources, same as an unconfigured adapter today.

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
- **Greenhouse / Lever / Ashby** (direct from a company's own public job
  board — no API key needed for any of the three):
  `GREENHOUSE_COMPANIES`, `LEVER_COMPANIES`, `ASHBY_COMPANIES`. Each is a
  comma-separated list of `token:Display Name` pairs, where `token` is
  that ATS's board identifier for the company (visible in the company's
  own careers-page URL, e.g. `boards.greenhouse.io/stripe` → token
  `stripe`) and `Display Name` is the human-readable name stored on every
  posting from that company. The display name may be omitted — the token
  itself is used verbatim if you leave off the `:Display Name` half, which
  is usually not what you want since a token is rarely how a company's
  name should read in search results. Example:
  `GREENHOUSE_COMPANIES=stripe:Stripe,figma:Figma`.

### Per-account role/country ingestion

Each signed-in account sets up to 5 roles and 3 countries at `/profile`
("Roles & countries"). Once saved, matching postings show up automatically
right on `/profile`, below the editor — one search per saved (role,
country) pair, merged and deduped, so there's no separate step to go find
them. JSearch and Adzuna are queried once per distinct `(role, country)`
pair across *every* account with both set — if two accounts both want
"staff software engineer" in "us", that's one API call for that pair, not
two. Countries are limited to the set `lib/ingestion/adzuna-countries.ts`
lists (Adzuna's supported codes, the stricter of the two adapters). An
account with no roles or no countries set contributes nothing to these two
sources, same as an ingestion adapter with no config does today; postings
from other accounts' pulls are still visible to them through the normal
shared `postings` search.

API keys and the Greenhouse/Lever/Ashby company lists can also be set from
the running app at `/settings`, instead of editing these env vars — any
signed-in account can view/edit them there by default (see
`SETTINGS_ADMIN_EMAILS` below to restrict that). These remain
instance-wide, unlike JSearch/Adzuna's roles/countries, which are set per
account at `/profile` (see above), not at `/settings`. A value saved from
`/settings` overrides its matching env var here; clearing it in the app
(saving it blank) reverts to whatever's in the env var, if anything. API
keys saved from `/settings` are encrypted at rest before being stored.

`SETTINGS_ADMIN_EMAILS` — optional, a comma-separated list of emails.
When set, only those accounts can view or edit `/settings`; everyone else
signed in is redirected away from the page and gets a `403` from its API.
Unset (the default) means any signed-in account can use `/settings`, same
as before this variable existed — set it if this deployment has, or might
ever have, more accounts than you want touching shared ingestion
credentials (sign-up in this app has no invite gate).

Rotating `SESSION_SECRET` makes any API keys already saved from
`/settings` unreadable (they're encrypted using a key derived from it) —
re-enter them from `/settings` afterwards; the non-secret fields
(queries, countries, company lists) are unaffected.

Ingestion runs two ways:

- **Scheduled**, via `POST /api/cron/ingest-postings`, which Vercel Cron
  calls on the `vercel.json` schedule (once daily, 6am UTC by default).
  This route requires `CRON_SECRET` to be set — without it, every call is
  refused with `401`, including Vercel's own.
- **Manually**, via `npm run db:ingest -w packages/web`, which runs the
  same ingestion against whatever `DATABASE_URL` is set to. Useful for
  local testing — see the Greenhouse/Lever/Ashby example above, which
  needs no API key and is the fastest way to get real postings into a
  local database.

## Configuring judging

Once postings exist, `judgments` gets populated by a scheduled pipeline
(`lib/judging/run-judging.ts`) that screens each account's not-yet-judged
postings against their stored profile (`constraints`/`background`/
`preferences`/`resume`, plus any custom documents) via
[OpenRouter](https://openrouter.ai/), using whichever model you name.

- `OPENROUTER_API_KEY` — an API key from your OpenRouter account.
- `JUDGE_MODEL` — the exact model string to call, e.g.
  `anthropic/claude-sonnet-4.5`. Any model OpenRouter serves that supports
  tool calling works; see [openrouter.ai/models](https://openrouter.ai/models).
- `JUDGE_BATCH_SIZE` — optional, defaults to 25. The most postings judged
  per account in one scheduled run; the rest are picked up next time.

Both `OPENROUTER_API_KEY` and `JUDGE_MODEL` are required for judging to do
anything — with either unset, `GET /api/cron/judge-postings` and
`npm run db:judge` both return immediately with no database or network
call, the same way an unconfigured postings-ingestion source does.

Judging runs two ways, mirroring ingestion:

- **Scheduled**, via `GET /api/cron/judge-postings`. Vercel Hobby only
  allows a cron job to run once a day, so this route isn't in
  `vercel.json` — it's called four times a day (starting an hour after
  the once-daily ingestion run) by the `judge` job in
  `.github/workflows/cron.yml` instead, which needs the `PROD_URL` and
  `CRON_SECRET` repo secrets set. On a Pro plan (or any host without that
  limit) this can move back into `vercel.json` unchanged. This route
  requires `CRON_SECRET` (shared with the ingestion cron route) —
  without it, every call is refused with `401`.
- **Manually**, via `npm run db:judge -w packages/web`, against whatever
  `DATABASE_URL` is set to.

An account with none of `constraints`/`background`/`preferences`/`resume`
stored is skipped entirely — there's nothing to judge a posting against.

Once an account has any routines (configurable at `/routines` — see
"Configuring routines" below), judge stops the global sweep described above
for that account entirely and instead judges only postings matching each
routine's own filter, using that routine's own prompt. An account with zero
routines is completely unaffected — it keeps getting the global sweep exactly
as described above. `JUDGE_BATCH_SIZE` applies per-routine when routines
exist, not shared across an account's routines in one run, so an account
with several routines does proportionally more model calls per scheduled
run — worth lowering the default if you configure many routines, given the
judge cron route's request timeout budget.

## Configuring resume tailoring

Once a posting has a `strong` or `fair` verdict, `tailored_resumes` gets
populated by a scheduled pipeline (`lib/tailoring/run-tailoring.ts`) that
generates a tailored resume PDF for it via
[OpenRouter](https://openrouter.ai/) — reusing `OPENROUTER_API_KEY` and
`JUDGE_MODEL` from "Configuring judging" above, no separate key or model
setting. The same model call also generates a cover letter, stored on
`tailored_resumes.cover_letter` — no additional environment variable is
needed for it.

- `TAILOR_BATCH_SIZE` — optional, defaults to 25. The most postings
  tailored per account in one scheduled run; the rest are picked up next
  time.

An account with no resume uploaded is skipped entirely. The generated PDF
follows one shared visual template for every account — only the section
order and contact block are carried over from the applicant's own resume,
not its fonts, colors, or layout (see
`docs/superpowers/specs/2026-09-14-resume-tailoring-design.md` for why).

Tailoring runs two ways, mirroring judging:

- **Scheduled**, via `GET /api/cron/tailor-resumes`. Same Hobby cron-frequency
  limit as judging above — this route runs four times a day (offset an
  hour after judging) via the `tailor` job in
  `.github/workflows/cron.yml`, not `vercel.json`. This route requires
  `CRON_SECRET` (shared with the other cron routes) — without it, every
  call is refused with `401`.
- **Manually**, via `npm run db:tailor -w packages/web`, against whatever
  `DATABASE_URL` is set to.

A generated resume is downloadable from `GET
/api/tailored-resumes/<posting id>` (also linked from the posting card
wherever one exists) once it's been tailored.

## Applying to postings

Once a posting has both a `strong`/`fair` verdict and a tailored resume, it's
ready to apply to. `/apply` lists every such posting for the signed-in
account that hasn't yet been marked applied — each entry shows the resume
download link, the generated cover letter, and a link back to the original
posting. Marking a posting applied removes it from this list.

- `GET /api/applications/queue` — the paginated queue behind the `/apply`
  page (same cursor convention as postings search).
- `POST /api/applications/<posting id>` — marks a posting applied, removing
  it from the queue.
- `DELETE /api/applications/<posting id>` — reverses that. There's no UI
  button for this in the current version — if you need to undo a mark, call
  the route directly.

## Configuring routines

A routine is a saved search filter — the same fields as `/search`'s filter
form — plus an optional custom judge prompt and an optional destination tab.
`/routines` lets you create, edit, and delete them for the signed-in account.
Once any routine exists for an account, it replaces that account's global
judge sweep, as described in "Configuring judging" above — see that section
for exactly what changes, rather than duplicating it here.

- `GET /api/routines` — list the account's routines.
- `POST /api/routines` — create one. The body is flat (the same shape as
  `/api/search`'s POST body, plus `name`, `judge_prompt`, and
  `destination_tab`) — as with search, `company` is a comma-joined string on
  write.
- `PUT /api/routines/<name>` — update a routine's filter, prompt, or
  destination tab. Not its name — renaming a routine is delete-and-recreate,
  there's no rename endpoint.
- `DELETE /api/routines/<name>` — delete one.

## Running the database-backed tests

Most of this app's tests run without a database at all. Everything under
`lib/auth-db.test.ts`, `lib/profile-db.test.ts`, `lib/tabs-db.test.ts`,
`lib/routines-db.test.ts`, `db/schema.test.ts`, `db/seed-postings.test.ts`,
and every `app/api/**`
route test that touches a table needs a real Postgres to run against —
each of these is written with `describe.skipIf(!process.env.TEST_DATABASE_URL)`,
so with no database configured they report SKIPPED, not FAILED, and the
rest of the suite stays green. That's convenient for a quick check, but it
also means a SKIPPED result is not evidence the database-backed code
actually works — the only way to know is to run it against a real Postgres
at least once whenever this code changes.

### 1. Get Docker running

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
if you don't already have it, and make sure it's started. Confirm:

```bash
docker --version
```

### 2. Start a local test Postgres

```bash
docker run --name talenttrove-web-test-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=talenttrove_web_test -p 5433:5432 -d postgres:16
```

This runs Postgres 16 in the background on port `5433` (deliberately not
the default `5432`, so it won't collide with anything else already
running) with a database named `talenttrove_web_test`. Confirm it's up with
`docker ps`. You only need to `run` it once — after that, `docker start
talenttrove-web-test-db` brings the same container back.

### 3. Point the test suite at it

```bash
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/talenttrove_web_test"
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5433/talenttrove_web_test"
```

This only lasts for the current shell session — set it again in every new
terminal, or add it to your shell profile if you want it permanent for
local dev.

### 4. Run the full suite for real

From the repo root:

```bash
npx vitest run
```

Every previously-SKIPPED database test should now actually run. Each
gated test file calls `runMigrations()` itself in `beforeAll`, so the
schema is applied automatically the first time — there's no separate
migration step needed just to run tests. Watch the summary line: no
`FAIL`, and the skip count should only cover tests that are genuinely
conditional on something else (there shouldn't be any at the time of
writing — every skip in this repo is the `TEST_DATABASE_URL` gate).

### Managing the container

```bash
docker stop talenttrove-web-test-db      # stop it
docker start talenttrove-web-test-db     # bring the same one back
docker rm -f talenttrove-web-test-db     # delete it entirely (e.g. to reset all data)
```

If you deleted it, just re-run the `docker run ...` command from step 2 to
get a fresh one.

## Applying migrations for real use

Outside of tests (which migrate themselves automatically), point
`DATABASE_URL` at whatever Postgres you're using and run:

```bash
DATABASE_URL="postgres://..." npx drizzle-kit migrate
```

## Seeding fake postings and manually testing tabs end-to-end

Tabs and search both need job postings to reference. Real ones now come
from the ingestion pipeline above (`npm run db:ingest`, once at least one
source is configured — Greenhouse needs no API key, see "Configuring
postings ingestion"). Before configuring any real source, or if you just
want fixed, predictable data for a quick manual check:

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/talenttrove_web_test" npm run db:seed -w packages/web
npm run dev -w packages/web
```

Then, with the dev server running:

1. Sign up / sign in.
2. Go to `/tabs`, create a tab.
3. Find a seeded posting's id — easiest way is querying the container
   directly: `docker exec -it talenttrove-web-test-db psql -U postgres -d
   talenttrove_web_test -c "select id, title from postings;"`.
4. Add that posting to your tab (via the UI once search exists, or by
   calling `POST /api/tabs/<name>/add` directly with `{"ids": ["<id>"]}`
   for now).
5. Delete that posting row from the database (`docker exec -it
   talenttrove-web-test-db psql -U postgres -d talenttrove_web_test -c "delete
   from postings where id = '<id>';"`) and reload the tab page — you
   should see the "no longer present" banner instead of the card
   silently vanishing.

This inserts a handful of fake postings (source `'seed'`) so you can walk
through the whole flow above without waiting on the real search pipeline.

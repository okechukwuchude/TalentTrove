# @pinloop/web

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

## Running the database-backed tests

Most of this app's tests run without a database at all. Everything under
`lib/auth-db.test.ts`, `lib/profile-db.test.ts`, `lib/tabs-db.test.ts`,
`db/schema.test.ts`, `db/seed-postings.test.ts`, and every `app/api/**`
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
docker run --name pinloop-web-test-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=pinloop_web_test -p 5433:5432 -d postgres:16
```

This runs Postgres 16 in the background on port `5433` (deliberately not
the default `5432`, so it won't collide with anything else already
running) with a database named `pinloop_web_test`. Confirm it's up with
`docker ps`. You only need to `run` it once — after that, `docker start
pinloop-web-test-db` brings the same container back.

### 3. Point the test suite at it

```bash
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/pinloop_web_test"
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5433/pinloop_web_test"
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
docker stop pinloop-web-test-db      # stop it
docker start pinloop-web-test-db     # bring the same one back
docker rm -f pinloop-web-test-db     # delete it entirely (e.g. to reset all data)
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

Tabs need job postings to reference, and the search/scraping project that
populates `postings` for real doesn't exist yet. Until it does:

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/pinloop_web_test" npm run db:seed -w packages/web
npm run dev -w packages/web
```

Then, with the dev server running:

1. Sign up / sign in.
2. Go to `/tabs`, create a tab.
3. Find a seeded posting's id — easiest way is querying the container
   directly: `docker exec -it pinloop-web-test-db psql -U postgres -d
   pinloop_web_test -c "select id, title from postings;"`.
4. Add that posting to your tab (via the UI once search exists, or by
   calling `POST /api/tabs/<name>/add` directly with `{"ids": ["<id>"]}`
   for now).
5. Delete that posting row from the database (`docker exec -it
   pinloop-web-test-db psql -U postgres -d pinloop_web_test -c "delete
   from postings where id = '<id>';"`) and reload the tab page — you
   should see the "no longer present" banner instead of the card
   silently vanishing.

This inserts a handful of fake postings (source `'seed'`) so you can walk
through the whole flow above without waiting on the real search pipeline.

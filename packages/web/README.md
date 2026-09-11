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

Most of this app's tests run without a database at all. The ones under
`lib/auth-db.test.ts`, `lib/email.test.ts` (no DB needed, but grouped with
the auth work), and the `app/api/auth/**` route tests need a real Postgres
to run against, and are skipped automatically when one isn't configured.

```bash
docker run --name pinloop-web-test-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=pinloop_web_test -p 5433:5432 -d postgres:16

export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/pinloop_web_test"
npm test
```

## Applying migrations for real use

```bash
DATABASE_URL="postgres://..." npx drizzle-kit migrate
```

## Seeding fake postings for local testing

Tabs need job postings to reference, and the search/scraping project that
populates `postings` for real doesn't exist yet. Until it does:

```bash
DATABASE_URL="postgres://..." npm run db:seed -w packages/web
```

This inserts a handful of fake postings (source `'seed'`) so you can create
a tab, add postings to it, and see the "no longer present" banner by
deleting one by hand.

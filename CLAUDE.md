# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

TalentTrove is a job-search web app: a Next.js app (`packages/web`) that
holds a large collection of job postings, a person's profile documents
(resume, constraints, background, preferences), judges postings against
that profile via an LLM, tailors a resume/cover letter for the ones worth
applying to, and lets the person apply. There is no CLI or separate hosted
server — the app is a single Next.js deployment (App Router, on Vercel),
with Postgres via Drizzle ORM and scheduled work (ingestion, judging,
tailoring) run through Vercel Cron hitting `app/api/cron/*` routes.

This repo was cut down from an earlier CLI-first version of the product;
the CLI package and its CLI-only shared modules have been removed.
`docs/superpowers/plans/` and `docs/superpowers/specs/` are dated
planning/design documents written during that earlier phase and while
building out the current web app — treat them as historical record of *why*
something is shaped the way it is, not as a live spec of current behavior
(check the code first).

## Commands

```
npm install                        # install dependencies
npm run build                      # builds packages/shared then packages/web
npm run dev -w packages/web        # Next.js dev server
npm run test                       # vitest, repo-wide
```

See [`packages/web/README.md`](packages/web/README.md) for the full list of
environment variables (session/database, postings ingestion adapters,
judging, resume tailoring) and for setting up the Docker-based Postgres
used by the database-backed test suite.

## Architecture

### Two packages

- `packages/web` — the whole product: Next.js App Router pages (`app/`),
  API routes (`app/api/**`), server-side data access (`lib/*-db.ts`),
  React Query hooks (`lib/*-queries.ts`), the Postgres schema and
  migrations (`db/`), and the three background pipelines (`lib/ingestion/`,
  `lib/judging/`, `lib/tailoring/`), each with a scheduled cron route and a
  `npm run db:*` script for running it manually.
- `packages/shared` — logic reused by both server-side route handlers and
  client-side components in `packages/web`, so neither keeps its own copy:
  the reserved profile-document registry, size caps, and refusal-message
  wording plus the default judge/quick-judge prompts (`registry.ts`), the
  "N/M" coverage-fraction convention (`coverage.ts`), and the four-word
  verdict scale (`verdicts.ts`).

When something is needed by more than one part of `packages/web`, it
belongs in `packages/shared`, not duplicated.

### Product shape

- **Profile documents.** A profile is a set of named text/file documents.
  A short list of names is reserved and means something fixed to the
  product (`constraints`, `background`, `preferences`, `resume`,
  `judge-prompt`, `quick-judge-prompt`, `application-instructions`) — see
  `packages/shared/src/registry.ts`. Any other name is a plain user
  document nothing in the product reads by itself.
- **Coverage fractions.** Whenever the app tells someone that something was
  left out, dropped, or skipped, it leads with how much of the whole came
  through, as a fraction of the real numbers (`996/1000`, never reduced) —
  see `packages/shared/src/coverage.ts` for the convention and why it's
  never simplified.
- **Verdicts.** A judged posting gets one of four words, worst to best:
  `no`, `weak`, `fair`, `strong` (`packages/shared/src/verdicts.ts`). Both
  the judging pipeline and any UI that filters or reports on judgments read
  this same ordered list.
- **Three scheduled pipelines**, each independent and each a no-op when its
  env vars aren't set: postings ingestion (`lib/ingestion/`, six source
  adapters), judging (`lib/judging/run-judging.ts`, via OpenRouter),
  resume tailoring (`lib/tailoring/run-tailoring.ts`, via OpenRouter). Each
  has a `GET`/`POST` cron route under `app/api/cron/` gated by
  `CRON_SECRET`, and a matching `npm run db:*` script for running it
  locally against `DATABASE_URL`.
- **Routines.** An account can replace the global judge sweep with one or
  more saved filters ("routines"), each with its own judge prompt and
  destination tab (`app/routines`, `app/api/routines`).

### Code style notes specific to this repo

The existing code favors long, discursive doc comments that explain *why* a
piece of code is shaped the way it is — often citing a specific date, a
specific person's ("Andrew's") observation, or a specific incident that
motivated the design. Treat strings like `DEFAULT_JUDGE_PROMPT` and the
refusal-message builders in `packages/shared/src/registry.ts` as if
changing their wording is a deliberate act, not a casual edit — several are
referenced from tests that check the exact text.

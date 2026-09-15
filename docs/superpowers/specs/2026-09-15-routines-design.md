# Routines: multiple scoped, per-routine judge pipelines

Status: approved design, pending spec review
Date: 2026-09-15

## Why

This idea was first raised several sessions ago and got one question in
(what gap would routines fill, given judge already runs autonomously)
before the user redirected to a different idea — tailoring a resume and
preparing to apply — which has since been built and merged
(`2026-09-14-resume-tailoring-design.md`, `2026-09-15-apply-design.md`).
The user has now asked to come back to routines.

**What's changed since the original question**: the full autonomous
pipeline is now real. Ingest → judge → tailor all run on their own
schedules, unattended. But judge and tailor are each **one hardcoded,
global pipeline**: judge sweeps every unjudged posting for every account
against one account-wide `judge-prompt` override (or the shared default),
with no way to scope which postings get judged or to use a different
prompt for different kinds of roles. This is already, concretely, what
the old CLI's own canonical description of a routine's value was —
*"search → judge → tab add ... is what fills a list of new finds
overnight"* — just not user-configurable yet.

**The concrete gap, confirmed with the user via a worked example**:
someone targeting both backend-engineer and data-scientist roles has to
write one `judge-prompt` covering both, which judges each kind of role
worse than a prompt written for just one would. Search/filters already
exist (`postings-search.ts`) but don't feed into judge at all — judge
judges the *entire* backlog regardless of what you'd search for.
Everything that scores well lands in one undifferentiated pile; tabs
exist but nothing auto-sorts into them.

**What this spec is not**: a port of the old CLI's `routine`/`schedule`/
`watch` three-tier structure, its per-account limits, its billing gate, or
its JSON step-array DSL. Every spec in this app since auth has been
personal/single-user with no billing model, and judge/tailoring already
established "fully autonomous, no confirm-gate" as this app's own
precedent. This spec is native to what already exists here: real search
filters, the existing per-account judge-prompt override mechanism
(generalized to per-routine), and existing tabs.

**Behavior once a routine exists, decided explicitly with the user**: the
moment an account has at least one routine, judge stops its global sweep
entirely for that account and *only* judges postings matching a defined
routine, using that routine's own prompt. An account with zero routines
keeps today's exact behavior unchanged — nothing breaks for the current
setup until a routine is actually created.

## What already exists and must not be redesigned

- **`packages/web/lib/judging/run-judging.ts`** — the per-account,
  per-posting isolation pattern this piece's routine loop nests inside.
  Its `DEFAULT_JUDGE_PROMPT` fallback, `callJudgeModel` tool-calling
  wrapper, and per-posting/per-account try/catch are all unchanged and
  reused as-is.
- **`packages/web/lib/postings-search.ts`'s `SearchFilters` type** — the
  exact filter shape (`q`, `country`, `workplace`, `employment`,
  `postedAfter`, `company`) a routine's stored filter reuses, minus
  `unjudged` (a query-time browsing concern, not something a routine
  needs to store — a routine's whole point is "judge the unjudged ones
  matching this").
- **`packages/web/lib/tabs-db.ts`'s `findTabByName`/`createTab`/
  `addPostingsToTab`** — reused unchanged for a routine's optional
  auto-filing step.
- **`packages/web/app/api/tabs/route.ts` and `app/api/tabs/[name]/
  route.ts`** — the name-addressed CRUD route shape (list/create at the
  collection route, get/update/delete at the `[name]` route) this spec's
  own routes mirror.
- **`packages/web/app/search/search-filters.tsx`** — the existing filter
  UI this spec's routine-creation form reuses (exact reuse mechanics —
  embed directly vs. extract a shared subcomponent — are an
  implementation-plan decision, not a spec-level one).

## Data model

```ts
// packages/web/lib/postings-search.ts
export type RoutineFilters = Omit<SearchFilters, 'unjudged'>;
```

```ts
export const routines = pgTable(
  'routines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(), // RoutineFilters — SearchFilters minus `unjudged`
    judgePrompt: text('judge_prompt'), // nullable; falls back to DEFAULT_JUDGE_PROMPT
    destinationTab: text('destination_tab'), // nullable; a tab NAME, not an id
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('routines_user_id_name_key').on(table.userId, table.name)],
);
```

`destinationTab` stores a tab *name*, not a foreign key, so a routine can
name a tab that doesn't exist yet (created automatically the first time
the routine files something into it — see "Judge pipeline integration"
below) — consistent with this app's existing "resolve tabs by name, not
id" convention everywhere else tabs are referenced.

`postings-search.ts`'s inline WHERE-condition-building logic is extracted
into a shared, exported `buildSearchConditions(filters: SearchFilters)`
helper (used by both `searchPostings` and the new routine-scoped judge
query), so the two call sites can never silently drift on what a given
filter actually matches.

## Judge pipeline integration

`run-judging.ts`'s per-account loop, after its existing "nothing to judge
against" profile-substance check (unchanged — that check is about whether
a *profile* exists to judge against, which doesn't vary per routine):

1. **Fetch the account's routines.**
2. **Zero routines**: fall through to today's exact global-sweep
   behavior, byte-for-byte unchanged.
3. **One or more routines**: the global sweep does not run. Iterate
   routines in `createdAt` order. For each:
   - Query candidates the same way as today (`postings LEFT JOIN
     judgments ... WHERE judgments.id IS NULL`, oldest-first) with the
     routine's `filters` applied via `buildSearchConditions`, capped at
     `JUDGE_BATCH_SIZE` **per routine** (not shared across an account's
     routines in one run — so one routine's backlog can't starve
     another's).
   - Judge each candidate with `routine.judgePrompt ?? DEFAULT_JUDGE_PROMPT`
     as the system prompt; profile documents (background/constraints/
     preferences/resume) are unchanged — only the instructions vary per
     routine, the same relationship the account-level override already
     has today.
   - On a `strong`/`fair` verdict, if `routine.destinationTab` is set:
     look the tab up by `(userId, name)`; if it doesn't exist, create it
     (via `createTab`, no description) rather than silently skipping —
     a routine you just configured to file into a tab should not
     silently do nothing because you haven't separately created that tab
     first. Then `addPostingsToTab`.
   - A posting matching more than one of an account's routines is judged
     exactly once, by whichever routine's turn comes first — this falls
     naturally out of `judgments`' existing `(user_id, posting_id)`
     unique index and each routine's query re-checking `judgments.id IS
     NULL` fresh (the previous routine's inserts have already committed
     by the time the next routine's query runs, since routines are
     processed sequentially, not in parallel). No new uniqueness rule is
     introduced.

`JudgingSummary`'s shape (`{userId, judged, failed}`) is unchanged — one
rolled-up entry per account per run, summed across whichever routines (or
the global sweep) that account used. Verdicts do not record which routine
(or prompt) produced them, consistent with today's behavior of not
recording which prompt produced a verdict either.

## Routines CRUD and the `/routines` page

Name-addressed routes, mirroring `/api/tabs`'s exact shape:

- **`GET /api/routines`** — list the account's routines.
- **`POST /api/routines`** — create (`name`, `filters`, `judgePrompt?`,
  `destinationTab?`). `400` if the name is empty or already taken by
  this account (matching `POST /api/tabs`'s exact validation shape).
- **`PUT /api/routines/[name]`** — update `filters`/`judgePrompt`/
  `destinationTab` (not the name — renaming is delete-and-recreate;
  routines are lightweight config, not worth a dedicated rename endpoint
  the way tabs has one).
- **`DELETE /api/routines/[name]`** — delete.

New `/routines` page, structured like `/tabs`: a list of routine cards
(name, a human-readable summary of its stored filter, its judge-prompt if
set, its destination tab if set, edit/delete actions) plus a creation
form whose filter portion reuses `/search`'s existing filter-fields UI.
No "run now" / manual-trigger button — matches judge's own established
precedent that this app clicks nothing; a routine takes effect on the
next scheduled judge run, same as every other configuration change in
this app already does.

## Error handling

Matches judge's existing convention exactly: one routine's failure (a
malformed stored filter, a model-call error) is caught and logged,
counted in that account's `failed` total, and does not stop the rest of
that account's routines or any other account's run — the same
per-posting/per-account isolation `run-judging.ts` already has, just with
one more level of nesting (per-routine) inside the per-account loop.

## Testing

- **Schema/migration test**: `routines` table + unique index, same
  pattern as every prior migration test in `db/schema.test.ts`.
- **`buildSearchConditions`**: extracted-helper unit tests confirming
  `searchPostings`'s existing filter test coverage still passes unchanged
  after the extraction (a refactor, not a behavior change).
- **`run-judging.ts`** gated tests, extending its existing suite: an
  account with zero routines still gets the exact global-sweep behavior
  (regression coverage for the fallback path); an account with one
  routine only judges postings matching that routine's filter, with that
  routine's prompt; two routines on the same account each get their own
  `JUDGE_BATCH_SIZE` cap; a posting matching two routines is judged once,
  by the first routine in creation order; a `strong` verdict with a
  `destinationTab` set files into that tab, creating it first if it
  doesn't exist; a routine with no `destinationTab` judges/tailors
  normally without filing anywhere.
- **Routines CRUD route tests**: 401/400/200 shapes mirroring the
  existing `/api/tabs` route tests exactly.
- **`/routines` page component test**: renders routine cards, the
  creation form submits the expected payload — mirroring `tabs-view.
  test.tsx`'s existing approach.

## Migration/rollout note

Same framing as every prior piece: personal/single-user, no live traffic
to protect. `routines` is a new table with nothing to migrate into it,
and its introduction is behavior-neutral for the current account until a
routine is actually created (see "Judge pipeline integration" above).

## Out of scope for this design

- The old CLI's `schedule`/`watch` concepts as separate tiers with their
  own cadence/delta-only semantics — a routine's own existence already
  *is* the schedule (it runs whenever judge's existing cron fires); there
  is no separate "how often" setting to configure per routine.
- Any billing/quota/per-account routine-count limit — this app has no
  billing model, and an arbitrary cap would be manufacturing a constraint
  that doesn't exist here.
- A manual "run this routine now" trigger — matches judge's own
  established no-manual-trigger precedent.
- Recording which routine (or prompt) produced a given verdict —
  verdicts don't record which prompt produced them today either; this is
  not a new gap this spec introduces.
- Tailoring or the `/apply` queue changing in any way — both already key
  off verdict existence and tailored-resume existence, not off which
  routine (or the global sweep) produced the verdict, so nothing about
  them needs to change for this piece to work.

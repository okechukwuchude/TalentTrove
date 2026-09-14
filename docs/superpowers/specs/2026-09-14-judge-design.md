# Judge: scheduled LLM screening of postings against a profile

Status: approved design, pending spec review
Date: 2026-09-14

## Why

Every prior piece of this web-app rebuild named judge as the thing it was
building toward but explicitly deferred: `2026-09-09-auth-database-foundation-design.md`
named it as one of five self-hosted-backend subprojects (auth, profile,
tabs, postings/search, judge); `2026-09-11-tabs-rebuild-design.md` and
`2026-09-12-postings-search-design.md` both listed it as "the next spec,"
needing real postings and a real profile to exist first. Both now exist.
This spec covers judge: screening a stored posting against an account's
profile documents with an LLM and recording a verdict.

**This app is expected to run autonomously.** Judging happens on a
schedule, the same way postings ingestion already does
(`POST /api/cron/ingest-postings`, `2026-09-12-postings-search-design.md`)
— no button, no confirm-before-spending dialog. The old CLI's
confirm-then-spend gate existed because Pinloop's hosted server enforced a
shared monthly judging quota across many accounts and wanted a
"you're about to spend real money" moment before a coding agent burned
through it unattended; neither the shared quota nor the multi-tenant
billing it protected exist in this self-hosted, personal app paying its
own OpenRouter bill directly. Explicitly not carried forward from the old
design: quota/allowance tracking, the two-call confirm-then-spend pattern,
and any manual "Judge now" UI action — clicking nothing is the point.

**Explicitly not in scope for this piece:** the old CLI's "quick screen"
mode (batch triage of up to 1,000 postings on facts alone, no job
description, meant to cheaply narrow a large set before a full judge run).
Full judge — one real verdict per posting, whole job description included
— is the only mode this spec builds. Quick screening is a distinct later
slice if it turns out to matter once real judging volume is seen.

## What already exists and must not be redesigned

The four-document judge prompt and the verdict scale are already fully
specified in `packages/shared`, not invented here:

- `packages/shared/src/registry.ts` — `RESERVED_NAMES` already reserves
  `judge-prompt` (text) alongside `resume`/`constraints`/`background`/
  `preferences`. `DEFAULT_JUDGE_PROMPT` is the exact instructions sent
  when an account has stored no override; `JUDGE_PROMPT_NAME` names the
  document that replaces it whole when present (blank-after-trim counts
  as none stored).
- `packages/shared/src/verdicts.ts` — `VERDICTS = ['no', 'weak', 'fair',
  'strong'] as const`, worst to best, plus `rankOf`/`dropReason` helpers
  already usable once real verdicts exist.

Both packages are already published as part of `@pinloop/shared` and
imported unchanged.

## Data model

One new table, `judgments`, user-scoped — unlike `postings` (shared/global
across every account, per `2026-09-11-tabs-rebuild-design.md`), a verdict
is inherently relative to one account's own profile:

```ts
export const judgments = pgTable(
  'judgments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postingId: uuid('posting_id').notNull(), // not a FK — same reasoning as tab_items.posting_id
    verdict: text('verdict').notNull(), // one of VERDICTS
    reasoning: text('reasoning').notNull(),
    model: text('model').notNull(), // which OpenRouter model produced it
    judgedAt: timestamp('judged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('judgments_user_id_posting_id_key').on(table.userId, table.postingId)],
);
```

`postingId` carries no foreign key for the same reason `tab_items.posting_id`
doesn't: a posting can be pruned by a future cleanup job without forcing a
choice between cascading away a stored verdict or blocking the cleanup.
The unique index on `(user_id, posting_id)` is the "already judged, don't
re-spend on it" check and the upsert target for re-judging.

## The model call

- **OpenRouter, no SDK.** A plain `fetch` POST to
  `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible chat
  completions shape), matching this codebase's existing "no new runtime
  dependency" convention from the five ingestion adapters — none of them
  carry a provider SDK either.
- **Structured output via tool-calling, not text parsing.** The request
  includes one tool, `submit_verdict`, whose parameters are `{verdict:
  enum('no'|'weak'|'fair'|'strong'), reasoning: string}`, and
  `tool_choice` forces the model to call it. The response is read from
  the tool call's arguments, not parsed out of free text — robust across
  whichever specific model `JUDGE_MODEL` names, and there is no
  free-text answer shape to keep in sync with the prompt by hand.
- **Prompt**: the account's own `judge-prompt` document
  (`getProfileDocument(userId, JUDGE_PROMPT_NAME)`, blank-after-trim
  treated as unset) if stored, else `DEFAULT_JUDGE_PROMPT` verbatim, sent
  as the system message.
- **Documents sent**: `constraints`, `background`, `preferences` as
  stored, plus every other custom (non-reserved) document the account
  has, each labeled with its own name — matching
  `DEFAULT_JUDGE_PROMPT`'s own description of what it's handed.
  `judge-prompt` itself is never included as a labeled document (it *is*
  the instructions, not part of the profile being read).
- **Resume**: extracted to text at judge time from the stored PDF bytes,
  reusing `lib/pdf.ts`'s existing `parseResumePdf` (already used at
  upload time to report page/character counts back to the uploader) —
  not attached as a PDF to the API call. This keeps the model call
  provider-agnostic (no per-provider PDF-attachment handling to build)
  and needs no new extraction code path. A resume that fails to parse at
  judge time (shouldn't happen — it was validated at upload — but the
  underlying bytes are opaque to us) is treated as "no resume," not an
  error that aborts the run.
- **The posting itself**: title, company, locations, workplace,
  employment, posted date, and — new to this piece — a `description`
  column judge needs but search doesn't. See "Schema: posting
  description" below.
- **Nothing to judge against**: if an account has none of
  `constraints`/`background`/`preferences`/a resume stored, it is skipped
  for this run entirely — logged, not an error, and no model call is
  made — since `DEFAULT_JUDGE_PROMPT` has nothing to judge a posting
  against otherwise. (Having only stored a custom `judge-prompt`
  override and nothing else counts as nothing stored, matching the old
  design's identical rule.)

### Schema: posting description

None of the five ingestion adapters currently populate a job description
— `postings` has no column for one, and search has never needed it. Judge
does: `DEFAULT_JUDGE_PROMPT` explicitly judges against "the complete
stored posting." This spec adds `description: text('description')`
(nullable) to `postings`, and extends each of the five adapters'
`RawPosting` mapping to capture it from their source's own response
(JSearch: `job_description`; Adzuna: `description`; Greenhouse: `content`,
already fetched via `?content=true` but currently discarded; Lever:
`descriptionPlain` or `description`; Ashby: `descriptionPlain`). A posting
ingested before this change, or whose source genuinely has no description
text, has `description: null` — judge treats that as "no job description
available" rather than refusing to judge it (the profile documents alone
still give the model something to work with, same as the old CLI's
`--quick` mode, just without that mode's own name or distinct prompt).

## The cron job

- **`packages/web/lib/judging/run-judging.ts`** exports
  `runJudging(): Promise<JudgingSummary[]>` (one summary entry per user
  that had at least one candidate posting) where
  `JudgingSummary = {userId: string; judged: number; skipped: number; failed: number}`.
  For every user: find postings with no `judgments` row for that user
  (`postings LEFT JOIN judgments ON judgments.posting_id = postings.id AND
  judgments.user_id = $user WHERE judgments.id IS NULL`), skip the user
  entirely (logged) if their profile has nothing to judge against, else
  judge up to `JUDGE_BATCH_SIZE` (default 25, env-overridable) of those
  postings oldest-ingested-first, one model call per posting, in
  sequence. A model-call failure for one posting is caught, logged, and
  counted in `failed` — it does not stop the rest of that user's batch or
  any other user's, mirroring `runIngestion`'s per-adapter isolation.
  Leftover postings beyond the batch cap are picked up by the next
  scheduled run.
- **`OPENROUTER_API_KEY` and `JUDGE_MODEL`** (e.g.
  `anthropic/claude-sonnet-4.5` — the account operator names the exact
  model) are both required; either unset makes `runJudging()` a no-op
  immediately, before touching the database, matching the "unconfigured
  adapter fetches nothing" convention every ingestion adapter already
  follows.
- **`GET /api/cron/judge-postings`** — `GET`, not `POST`: Vercel Cron
  always invokes a scheduled route with `GET` (the ingestion cron route
  was originally built as `POST` and had to be corrected after a
  whole-branch review caught that scheduled ingestion could never
  actually run in production — this piece starts from that lesson rather
  than repeating it). The same `Authorization: Bearer $CRON_SECRET` guard
  (`crypto.timingSafeEqual`, length-checked first) as the ingestion cron
  route, and the same `export const maxDuration = 300`. Calls
  `runJudging()` and returns `{rows: summary}`.
- **`packages/web/vercel.json`** gains a second `crons` entry —
  `{"path": "/api/cron/judge-postings", "schedule": "0 1,7,13,19 * * *"}`
  — every 6 hours, offset one hour after ingestion's `0 */6 * * *`, so a
  batch of freshly-ingested postings has something to judge by the time
  this runs. (Vercel Cron always dispatches `GET` regardless of what the
  config says, same as the ingestion entry — nothing in `vercel.json`
  itself names a method.)
- **`npm run db:judge`** (`packages/web/package.json`), mirroring
  `db:ingest`: a `tsx`-run CLI entrypoint into the same `run-judging.ts`
  module, for manual/local runs, closing its own DB connection pool on
  exit the same way `run-ingestion.ts`'s entrypoint does (reusing
  `closeDb()` from `lib/db.ts`).

## Surfacing verdicts

- **`lib/postings-search.ts`'s `searchPostings` gains a required `userId`
  parameter** (`searchPostings(userId, filters, limit, cursor)`) — it
  currently takes none, because nothing before this piece needed
  per-account data joined into a search result. `POST /api/search`'s
  route handler is updated to pass `auth.user.userId` through. The query
  gains a `LEFT JOIN judgments ON judgments.posting_id = postings.id AND
  judgments.user_id = $userId`; `filters.unjudged` — accepted since the
  postings-search piece but documented there as a no-op — becomes real:
  `WHERE judgments.id IS NULL` when set.
- **`lib/tabs-db.ts`'s `getTabContents`** already takes `userId`; it
  gains the same `LEFT JOIN judgments` (tabs need no `unjudged` filter of
  their own — a tab's contents are already an explicit, bounded list).
- **`PostingJson`** (currently exported from `tabs-db.ts`, imported by
  `postings-search.ts`) gains two optional fields:
  `verdict?: string; verdict_reasoning?: string` — present only when a
  `judgments` row exists for that posting/user, mirroring the existing
  convention of omitting rather than nulling absent optional fields
  (`workplace`, `employment`, `locations`).
- **`<PostingCard>`** (`packages/web/components/posting-card.tsx`) shows
  a small verdict badge (the word, colored by rank — `no` dimmest,
  `strong` most prominent, matching `VERDICTS`' own worst-to-best order)
  plus a one-line reasoning excerpt when `verdict` is present on a row.
  No badge at all when absent — "not yet judged" is not itself a status
  worth a visual, since most postings will sit in that state between
  cron runs.

## Error handling

Same convention as ingestion: `runJudging()` never throws for a single
posting's or a single user's failure — caught, logged
(`console.error`), and counted, so one bad model response or one
malformed profile document doesn't stop the run. The cron route itself
follows the same 401-on-bad-secret shape as ingestion's, and logs
(without failing the response) when every candidate user's batch came
back with `failed > 0` for all of it — the same "the dashboard only
shows this route's status code, not its body" reasoning documented on
the ingestion cron route.

## Testing

- **`lib/judging/openrouter.ts`** (the tool-calling request/response
  wrapper, isolated from `run-judging.ts`'s per-user/per-posting looping
  the same way `lib/ingestion/shared.ts`'s helpers are isolated from each
  adapter): unit tests with a mocked `fetch`, covering a successful
  tool-call response, a response that omits the tool call entirely
  (treated as a failure, not a crash), and an HTTP failure from
  OpenRouter itself.
- **`lib/judging/run-judging.ts`**: gated on `TEST_DATABASE_URL`
  (`describe.skipIf`, this codebase's standing convention), covering: a
  user with no profile substance is skipped without a model call; a
  user's already-judged posting is not re-judged; one posting's
  model-call failure doesn't stop the rest of the batch; the
  `JUDGE_BATCH_SIZE` cap is respected when more candidates exist than the
  cap.
- **`POST /api/cron/judge-postings` route test**: 401 on missing/wrong
  secret (including an equal-length-wrong-content case, learned from the
  ingestion cron route's own review), 200 with the correct secret — using
  the same "every dependency unconfigured, so no real network/DB call
  needed for the success path" trick the ingestion cron test already
  uses (`OPENROUTER_API_KEY`/`JUDGE_MODEL` unset → `runJudging()`
  no-ops).
- **`postings-search.ts`/`tabs-db.ts` gated tests** get a case each
  covering the new `LEFT JOIN judgments`: a posting with a stored verdict
  carries `verdict`/`verdict_reasoning` in its `PostingJson`; one without
  carries neither; `unjudged: true` excludes the judged one.
- **`<PostingCard>` test**: renders the badge when `verdict` is present,
  omits it when absent.

## Migration/rollout note

Same framing as every prior piece: personal/single-user, no live traffic
to protect. The `postings.description` column is additive and nullable —
existing rows simply read as "no description," judged with less signal
than a freshly-ingested one would be. `judgments` is a new table with no
data to migrate into it. New required env vars (`OPENROUTER_API_KEY`,
`JUDGE_MODEL`) and one optional one (`JUDGE_BATCH_SIZE`) get the same
`.env.example`/README documentation treatment the postings-ingestion
variables already received — this piece does not repeat that gap.

## Out of scope for this design

- Quick/batch screening (the old CLI's `--quick` mode).
- A manual "Judge now" UI action, and the confirm-then-spend two-call
  pattern that would gate it.
- Quota/allowance tracking of any kind.
- Routines/schedules as their own user-facing automation concept (this
  piece is itself one hardcoded scheduled pipeline, not a general
  "account-configurable automation" system).
- Re-judging a posting whose stored verdict already exists (no `--again`
  equivalent) — the unique index simply prevents a second `judgments` row
  from ever being created for the same `(user, posting)` pair; a future
  piece can add deliberate re-judging if it turns out to matter.

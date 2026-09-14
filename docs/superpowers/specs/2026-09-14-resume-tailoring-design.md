# Resume tailoring: scheduled per-posting tailored PDFs

Status: approved design, pending spec review
Date: 2026-09-14

## Why

Judge (`2026-09-14-judge-design.md`) screens every stored posting against
an account's profile and records a verdict, but it never produces
anything an applicant can hand to an employer. This spec adds the next
autonomous step: once judge marks a posting `strong` or `fair`, generate
a tailored resume PDF for that specific posting, unattended, the same way
judging itself already runs unattended.

**Auto-apply is explicitly out of scope for this piece.** The original
idea behind this feature was "find roles and apply with a matching CV,"
but actually submitting an application is a distinct, much higher-risk
subsystem — every source (Greenhouse/Lever/Ashby/aggregator listings) has
its own application form, and doing that autonomously means live,
irreversible submissions with no human reviewing what went out under the
applicant's name before it's sent. This spec produces the tailored
resume as a stored, downloadable artifact only. Auto-apply, if it
happens, is a separate future spec built on top of this one.

**This app is expected to run autonomously**, same framing as judge:
tailoring fires from a schedule, no button, no confirm-before-spending
dialog — this app pays its own OpenRouter bill directly and has no
shared quota or multi-tenant billing to protect.

**Visual fidelity is intentionally limited.** The original ask was to
mirror the applicant's own resume's look. True visual mirroring (columns,
fonts, accent colors) would require rendering the resume's PDF page as an
image and analyzing it with a vision-capable model — new infrastructure
this app doesn't have. This spec instead extracts *structure* only
(section order/headings, contact block) from the resume's existing
plain-text extraction, and renders every tailored resume through **one
shared visual template**. What's echoed from the original is the section
order and the contact information, carried through verbatim — not the
original's fonts, colors, or column layout.

## What already exists and must not be redesigned

- **`packages/web/lib/judging/run-judging.ts`** — the per-account,
  per-posting isolation pattern this piece's orchestration mirrors
  exactly: one account's failure (a bad profile document, a DB error)
  never aborts another account's run; one posting's model-call failure
  never aborts the rest of that account's batch.
- **`packages/web/lib/judging/openrouter.ts`** — the forced-tool-call
  pattern (`tool_choice` pinned to one named tool, response read from the
  tool call's arguments, never parsed from free text) this piece's two
  model calls both follow.
- **`packages/web/lib/pdf.ts`'s `parseResumePdf`** — already extracts
  plain text (and page/character counts) from the stored resume PDF's
  bytes; this piece's style-extraction step reads that same text, it
  does not re-parse the PDF itself.
- **`packages/web/db/schema.ts`'s `profileDocuments`** — the resume is
  stored as the row named `resume`, `kind = 'file'`, bytes in
  `fileBytes` (a `bytea` custom type already defined in this file).
- **`packages/web/db/schema.ts`'s `judgments`** — the exact shape (user
  FK cascade, non-FK `postingId`, unique index on
  `(user_id, posting_id)`) this piece's new `tailoredResumes` table
  mirrors.

## Data model

Two schema changes.

**1. `profileDocuments` gains one nullable column**, meaningful only on
the row named `resume`:

```ts
styleProfile: jsonb('style_profile'), // cached StyleProfile JSON — see below
```

It holds the cached extraction result (shape defined in "Content
generation" below): section order and contact info, computed once and
reused across every tailoring run until the resume file changes. The
existing profile-document upload path that replaces the `resume` row's
`fileBytes` gains one added line: set `styleProfile` back to `null`
whenever the file changes, so the next tailoring run recomputes it
against the new resume rather than rendering with a stale extraction.

**2. New `tailoredResumes` table**, same shape as `judgments`:

```ts
export const tailoredResumes = pgTable(
  'tailored_resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postingId: uuid('posting_id').notNull(), // not a FK — same reasoning as judgments.postingId
    pdfBytes: bytea('pdf_bytes').notNull(),
    model: text('model').notNull(), // which OpenRouter model produced the content
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tailored_resumes_user_id_posting_id_key').on(table.userId, table.postingId)],
);
```

The unique index is both the "already tailored, don't regenerate" guard
(`onConflictDoNothing()` on insert) and the join key the candidate query
filters on (`LEFT JOIN tailored_resumes ... WHERE tailored_resumes.id IS
NULL`).

## Content generation

Two forced-tool-call OpenRouter requests, both in a new
`packages/web/lib/tailoring/openrouter.ts`, both reusing the same
`OPENROUTER_API_KEY`/`JUDGE_MODEL` env vars judge already reads — no new
model or API-key configuration for this piece.

### `extractStyleProfile` — once per resume, cached

```ts
type StyleProfile = {
  sectionOrder: string[]; // canonical section keys found, in original order — subset of ['summary','skills','experience','education']
  contact: { name: string; email: string; phone?: string; location?: string; links?: string[] };
};
type StyleProfileResult = StyleProfile | { error: string };

extractStyleProfile(apiKey: string, model: string, resumeText: string): Promise<StyleProfileResult>
```

Input is the resume's already-extracted plain text
(`parseResumePdf(...).text`). The tool schema forces `sectionOrder`
(enum array over the four known section keys) and `contact` (name/email
required, phone/location/links optional). This runs once per resume —
the result is cached on `profileDocuments.styleProfile` and reused for
every posting and every run until the resume file changes.

### `tailorResumeContent` — once per posting

```ts
type TailoredContent = {
  summary: string;
  skills: string[];
  experience: Array<{ title: string; company: string; dates: string; bullets: string[] }>;
  education: Array<{ degree: string; school: string; dates: string }>;
};
type TailorContentResult = TailoredContent | { error: string };

tailorResumeContent(
  apiKey: string,
  model: string,
  request: { resumeText: string; postingText: string; profileText: string; sectionOrder: string[] },
): Promise<TailorContentResult>
```

`postingText` uses the same shape `run-judging.ts`'s `buildPostingText`
already builds (title/company/locations/workplace/employment/posted
date/url/description). `profileText` uses the same shape
`buildProfileText` already builds (background/constraints/preferences +
custom documents), **minus the resume itself**, which is passed
separately as `resumeText` so the model tailors real resume content
rather than paraphrasing profile notes. `sectionOrder` is the cached
value from `extractStyleProfile`, passed through so the model only fills
content for sections the original resume actually had.

**Contact info is never requested from this call.** It is merged back in
afterward from the cached `StyleProfile.contact`, so the tailoring model
has no opportunity to invent or alter a phone number, email, or link.

Both calls return `{error: string}` — never throw — on a missing tool
call, a non-ok HTTP response, or (for `extractStyleProfile`) an empty
`sectionOrder`, matching `callJudgeModel`'s existing failure contract.

## PDF rendering

New dependency: **`@react-pdf/renderer`** — pure JS, Node-compatible, no
headless browser, fits this app's existing "plain `fetch`, no heavy
SDK/browser dependency" convention (none of the five ingestion adapters
or judge carry one either) and runs inside a Vercel Cron function without
the memory/cold-start problems a headless-Chromium approach would add.

One fixed template component,
`packages/web/lib/tailoring/resume-template.tsx`, exporting
`TailoredResumeDocument`, a React component taking
`{contact, sectionOrder, summary, skills, experience, education}` as
props. It renders the four known sections in the order given by
`sectionOrder`, skipping any that are empty; `sectionOrder` entries
outside the four known keys are ignored (v1 has no certifications/
projects/custom sections — easy to extend later, not built now).
Rendered server-side via `renderToBuffer(<TailoredResumeDocument ... />)`
— no network call, directly unit-testable by rendering fixed props and
asserting the output buffer starts with the PDF magic bytes (`%PDF`).

**Every generated resume shares this one visual design** (fonts, colors,
column layout) — see "Why" above for why per-applicant visual styling is
out of scope.

## The cron job

- **`packages/web/lib/tailoring/run-tailoring.ts`** exports
  `runTailoring(): Promise<TailoringSummary[]>` where
  `TailoringSummary = {userId: string; tailored: number; failed: number}`
  (one entry per user with at least one candidate posting). No-ops
  immediately (returns `[]`, no DB call) if `OPENROUTER_API_KEY` or
  `JUDGE_MODEL` is unset, matching every other pipeline's unconfigured
  convention.
  For every user, in this order (candidates are checked — a cheap DB
  query — before the style profile is ensured, so an account with
  nothing to tailor never pays for a style-extraction model call):
  1. Skip if no `resume` row with `fileBytes` exists.
  2. Find candidates: postings with a `judgments` row for this user whose
     `verdict` is `strong` or `fair`, and no `tailored_resumes` row yet:
     ```sql
     postings
       JOIN judgments ON judgments.posting_id = postings.id
         AND judgments.user_id = $userId
         AND judgments.verdict IN ('strong', 'fair')
       LEFT JOIN tailored_resumes ON tailored_resumes.posting_id = postings.id
         AND tailored_resumes.user_id = $userId
     WHERE tailored_resumes.id IS NULL
     ORDER BY judgments.judged_at ASC
     LIMIT $TAILOR_BATCH_SIZE
     ```
     (`TAILOR_BATCH_SIZE` default 25, env-overridable, same
     parse-with-fallback pattern as `JUDGE_BATCH_SIZE`.) Skip the account
     (no summary entry, matching the no-resume skip) if this returns
     zero rows.
  3. If `styleProfile` isn't cached, call `extractStyleProfile`; on
     failure, skip the whole account (logged, no summary entry) —
     nothing downstream can proceed without a section order and contact
     block. On success, save it back to `profileDocuments.styleProfile`.
  4. For each candidate: `tailorResumeContent`, then render, then
     `insert().onConflictDoNothing()`. A failure at either step is
     caught, logged, and counted in `failed` — does not stop the rest of
     that user's batch or any other user's. Leftover candidates beyond
     the batch cap are picked up by the next scheduled run.
- **`GET /api/cron/tailor-resumes`** — `GET`, not `POST` (Vercel Cron
  always dispatches `GET`; both prior cron routes already establish
  this). Same `Authorization: Bearer $CRON_SECRET` guard
  (`crypto.timingSafeEqual`, length-checked first) and the same `export
  const maxDuration = 300` as the other two cron routes. Calls
  `runTailoring()` and returns `{rows: summary}`.
- **`packages/web/vercel.json`** gains a third `crons` entry —
  `{"path": "/api/cron/tailor-resumes", "schedule": "0 2,8,14,20 * * *"}`
  — one hour after judge's `0 1,7,13,19 * * *`, so a batch of
  freshly-judged postings has something to tailor by the time this runs.
- **`npm run db:tailor`** (`packages/web/package.json`), mirroring
  `db:judge`: a `tsx`-run CLI entrypoint into `run-tailoring.ts`, closing
  its own DB connection pool via `closeDb()` on exit.

## Surfacing

- **New `GET /api/tailored-resumes/[postingId]`** route — authenticated,
  scoped to the session's `userId`. Returns `404` (never `403`) if no
  `tailored_resumes` row exists for that user/posting pair, matching this
  codebase's standing ownership-mismatch convention. On success:
  `Content-Type: application/pdf`,
  `Content-Disposition: attachment; filename="..."`, body is the stored
  `pdfBytes`.
- **`lib/postings-search.ts`'s `searchPostings` and
  `lib/tabs-db.ts`'s `getTabContents`** each gain one more `LEFT JOIN`
  (against `tailoredResumes`, scoped to `userId` in the join condition
  itself, same pattern as the existing `judgments` join) adding an
  optional `has_tailored_resume?: boolean` to `PostingJson` — present
  (and `true`) only when a row exists, omitted otherwise, matching the
  existing convention of omitting rather than nulling absent optional
  fields.
- **`<PostingCard>`** shows a "Download tailored resume" link (pointing
  at the new route) alongside the existing verdict badge, only when
  `has_tailored_resume` is true. No link at all otherwise — "not yet
  tailored" is not a status worth a visual, matching how "not yet judged"
  is handled.

## Error handling

Same convention as judge and ingestion: neither the style-extraction
step nor the per-posting tailoring/render step ever throws out of
`runTailoring()` — caught, logged (`console.error`), and counted, so one
bad model response, one render failure, or one account's DB error never
stops the rest of the run. The cron route follows the same 401-on-bad-
secret shape as the other two cron routes.

## Testing

- **`lib/tailoring/openrouter.ts`**: unit tests with a mocked `fetch`,
  covering both `extractStyleProfile` and `tailorResumeContent` each
  against a successful tool-call response, a response missing the tool
  call, and a non-ok HTTP response.
- **`lib/tailoring/resume-template.tsx`**: unit test rendering fixed
  props through `renderToBuffer` and asserting the output starts with
  the PDF magic bytes — no network, no database.
- **`lib/tailoring/run-tailoring.ts`**: gated on `TEST_DATABASE_URL`
  (`describe.skipIf`), covering: an account with no resume is skipped
  (no model call, no DB write attempted for it); the style profile is
  computed once and reused across multiple postings and multiple runs
  (inject a fake style-extraction caller, assert call count stays at 1);
  an already-tailored posting is not retailored; one posting's failure
  doesn't stop the rest of the batch; `TAILOR_BATCH_SIZE` is respected
  when more candidates exist than the cap.
- **`GET /api/cron/tailor-resumes` route test**: mirrors
  `judge-postings/route.test.ts`'s four cases (no header, wrong-length
  secret, equal-length-wrong-content secret, 200-and-no-op when
  `OPENROUTER_API_KEY`/`JUDGE_MODEL` are unset).
- **`GET /api/tailored-resumes/[postingId]` route test**: 404 for a
  posting with no stored tailored resume, 404 for a resume that belongs
  to a different user, 200 with the correct `Content-Type` for an
  existing one.
- **`postings-search.ts`/`tabs-db.ts` gated tests** get one more case
  each for the new join: a posting with a stored tailored resume carries
  `has_tailored_resume: true`; one without carries the field omitted.
- **`<PostingCard>` test**: renders the download link when
  `has_tailored_resume` is true, omits it otherwise.

## Migration/rollout note

Same framing as every prior piece: personal/single-user, no live traffic
to protect. `profileDocuments.styleProfile` is additive and nullable —
every existing resume row simply has it computed on the first tailoring
run that reaches that account. `tailored_resumes` is a new table with no
data to migrate into it. One new optional env var
(`TAILOR_BATCH_SIZE`) gets the same `.env.example`/README documentation
treatment the judge and ingestion variables already received.

## Out of scope for this design

- **Auto-apply** — actually submitting the tailored resume anywhere.
  Explicitly deferred to a separate future spec; see "Why" above.
- Per-applicant visual styling (fonts, colors, column layout) — every
  tailored resume shares one visual template; see "Why" above.
- Vision-based style extraction from a rendered PDF image.
- Sections beyond summary/skills/experience/education (certifications,
  projects, custom sections).
- Re-tailoring a posting whose tailored resume already exists — the
  unique index prevents a second row for the same `(user, posting)`
  pair; a future piece can add deliberate re-tailoring (e.g., after a
  profile edit) if it turns out to matter.
- A manual "Tailor now" UI action.
- Routines/schedules as a general user-facing automation concept — this
  piece is itself one more hardcoded scheduled pipeline, same as judge
  and ingestion, not a configurable automation system.

# Replacing the Pinloop CLI with a web app

Status: approved design, pending spec review
Date: 2026-09-08

## Why

Pinloop is currently used through `pinloop`, a command line published to npm and
meant to be driven by a coding agent on a person's behalf. This project
replaces that interface with a web app that a person uses directly in a
browser, starting from — but not limited to — the flow that prompted this:
uploading and managing a CV/profile. The CLI (`packages/cli` after this
project's restructuring) is retired once the web app reaches parity with it.

The web app is a new client against the existing hosted backend
(`api.pinloop.ai`). This project does not redesign the backend; it calls the
same endpoints the CLI calls today. Any backend gap discovered while building
a given page is called out where it comes up, not solved here.

## Repo structure

This repo becomes an npm-workspaces monorepo:

```
pinloop-cli/
├── package.json          # workspaces root, private
└── packages/
    ├── shared/            # today's src/shared/, unchanged in spirit: pure,
    │                      # framework-agnostic logic (filter.ts, coverage.ts,
    │                      # registry.ts, guide-text.ts, verdicts.ts, limits.ts, ...)
    ├── cli/                # today's src/cli/, moved as-is. Keeps publishing to
    │                       # npm and working unchanged until the final cutover
    │                       # step below — nothing breaks for existing users
    │                       # mid-project.
    └── web/                # new: Next.js app, deployed to Vercel
        └── app/
            ├── (auth)/sign-in/
            ├── profile/
            ├── search/
            ├── tabs/
            ├── routines/
            ├── schedules/
            ├── watches/
            ├── billing/
            └── api/        # BFF route handlers (see "API/data layer")
```

`packages/shared` is not rewritten: it is logic that has never cared whether
its caller is a terminal or a browser, and stays that way. `packages/cli` is a
straight move so the existing package keeps shipping throughout the build-out.
Almost all new work happens in `packages/web`.

## Auth & session model

**Corrected a second time, against a real, working sign-in.** The
short-code hand-off described below (v1) was implemented, then tested by
hand against the real hosted sign-in page, and failed: `pinloop.ai/login`
closes itself immediately after the emailed code is entered, with or without
a `port`/`secret` query string, and never displays the fallback short code
the CLI relies on. That mechanism appears to only work for the CLI's
loopback-listener scenario, not a plain browser tab.

**What's actually implemented and confirmed working:** the web app calls two
of the login service's own endpoints directly — `POST /auth/send-code`
(`SEND_CODE_PATH`) and `POST /auth/verify-code` (`VERIFY_CODE_PATH`), both
already named in `src/shared/sign-in.ts` — from its own BFF, bypassing
`pinloop.ai/login` entirely:

- **Sign-in**: `/sign-in` is a two-step form. Step 1 takes an email address
  and calls `POST /api/auth/send-code`, which forwards to the server's
  `SEND_CODE_PATH`. Step 2 takes the emailed 6-digit code and calls
  `POST /api/auth/verify-code`, forwarding to `VERIFY_CODE_PATH` with
  `{ email, code }`; on success the server returns a pass exactly like
  `HANDOFF_TRADE_PATH` does, and the BFF seals it into the session cookie the
  same way. No new tab, no code relay, no dependency on `pinloop.ai/login` at
  all.
- **Google/GitHub sign-in is dropped for now.** Those genuinely do need
  `pinloop.ai/auth/callback`'s OAuth redirect (allowlisted to that one
  address), which is a separate, still-unsolved problem from the short-code
  one — revisit only if OAuth sign-in turns out to matter enough to justify
  coordinating with whoever owns that page.
- **Request shape was not confirmed against documentation** — the CLI never
  calls `send-code`/`verify-code` itself (only the login page does), so
  there was no reference implementation to copy. `{ email }` and
  `{ email, code }` were the first guess, tried against the real server, and
  worked. If the server ever changes these field names, `packages/web/lib/pinloop-server.ts`'s
  `requestEmailCode`/`verifyEmailCode` are the one place to update.
- **The short-code mechanism (`HANDOFF_PATH`/`HANDOFF_TRADE_PATH`) is still
  implemented** (`/api/auth/handoff`, `tradeHandoffCode`) but has no working
  UI path calling it anymore — kept because it's tested and correct against
  what it does, in case a loopback-capable context ever needs it again, not
  because anything currently exercises it end-to-end.
- **Fast-follow, not part of this project, unchanged from before**: a
  `window.opener.postMessage`-based flow would let OAuth sign-in work too,
  but needs edits to `pinloop.ai/auth/callback` itself, outside this repo.
- **Session storage**: on a successful code verification, the BFF route
  handler (`/api/auth/verify-code`) that received the `access_token`/`refresh_token`
  pair sets **one httpOnly, Secure, SameSite=Lax session cookie** (`Secure`
  only when `NODE_ENV=production`, so local testing works in every browser,
  not just the ones that treat `http://localhost` as trustworthy). No token
  is ever readable by page JavaScript. This is the web equivalent of the
  CLI's `credentials.json` written with `0600` permissions — the goal in both
  cases is "not casually readable by anything else on the machine/in the
  page."
- **Every other route handler** (`/api/profile/*`, `/api/search`,
  `/api/judge`, `/api/routines/*`, `/api/schedules/*`, `/api/watches/*`,
  `/api/billing`) reads the session cookie server-side, attaches
  `Authorization: Bearer <access_token>` when calling `api.pinloop.ai`, and on
  a `401` performs the same one-shot renewal the CLI's `callAsAccount` does
  today: trade the refresh token once, retry the original call once. If that
  retry also fails, the route handler responds `401` and the frontend redirects
  to `/sign-in` with a "your session expired" message (the web equivalent of
  the CLI's `LOG_IN_AGAIN`).
- **Sign-out** clears the session cookie and calls the server's revoke
  endpoint if the backend has one.
- There is exactly one session per browser (its cookie jar) — no
  `PINLOOP_CONFIG_DIR` equivalent, no multi-account file switching.

**Open question (backend verification, not a design gap):** whether
`/auth/refresh`'s refresh token rotates (single-use) or is reusable. If it
rotates, concurrent requests from multiple tabs racing a refresh need a mutex
or single-flight guard around the refresh call in the BFF layer to avoid one
tab invalidating the token another tab just used. Verify against the real
backend before or during implementation; the design above holds either way,
this only affects one function's internals.

## API/data layer

- **One proxy helper**, `callPinloopServer(path, options)`, used by every
  route handler under `app/api/*`. It is a direct port of `pinloop.ts`'s
  `callServer`/`callAsAccount`: attach the bearer token, attach a
  `pinloop-web-version` request header (the web equivalent of
  `pinloop-cli-version`), read back `pinloop-latest-version` /
  `pinloop-minimum-version` / `pinloop-unread` response headers, perform the
  one-shot refresh-and-retry on 401, and surface the server's own error text
  on failure rather than inventing a new message. No route handler
  reimplements auth or retry logic itself.
- **Streaming passthrough for judge.** `app/api/judge/route.ts` calls
  `POST /judge` with the same progress-stream `Accept` header `pinloop.ts`
  sends, and instead of buffering the response, returns the upstream
  `ReadableStream` directly to the browser (Next.js route handlers support
  returning a stream). The browser reads and splits it into lines using the
  same approach as `readLines` in `pinloop.ts`, updating UI state per line as
  it arrives, and treating the final line as the answer — same contract, same
  ordering guarantee (no line is held back to find out it was the last one).
  Only judge's *second* (confirmed) call is actually streamed — its dry-run
  call is small buffered JSON like every other route. See "Search, Tabs &
  Judge, in detail" below for the concrete split and the `streamAsAccount`
  proxy primitive it needs.
- **Client-side data fetching**: TanStack Query (React Query). Reads (profile
  list, search results, tab contents, routine/schedule/watch lists, billing
  status) are queries with normal caching/refetch-on-focus behavior. Mutations
  (profile put/delete, judge, routine/schedule/watch put) are
  `useMutation`s, and this is where the confirm-spend flow below hooks in.
- **No separate global client store.** Server state lives in React Query's
  cache; the only client-only state (open modals, selected rows, form drafts)
  is local component state. Nothing in this app needs cross-page client state
  a query cache doesn't already provide.

## Feature / page map

| Page | Replaces | Backing endpoint(s) |
|---|---|---|
| `/sign-in` | `pinloop login` | `POST /auth/send-code`, `POST /auth/verify-code`, `POST /auth/refresh` |
| `/profile` | `pinloop profile *` | `GET/POST/DELETE /profile/{name}` |
| `/search` | `pinloop search`, `pinloop list`, `pinloop companies` | `POST /search`, `GET /companies` |
| `/tabs` | `pinloop tab *` | tab CRUD endpoints |
| judge dialog (launched from search/tab results) | `pinloop judge` | `POST /judge` (confirm-gate + streamed progress) |
| `/routines` | `pinloop routine *` | routine CRUD + run (confirm-gate) |
| `/schedules`, `/watches` | `pinloop schedule *`, `pinloop watch *` | CRUD (confirm-gate on `put`) |
| `/billing` | `pinloop billing` | billing status endpoint |
| account menu / inbox | unread-message notice, `pinloop message` | `pinloop-unread` header + message endpoint |
| `/` (dashboard) | `pinloop` typed bare | summary: allowance left, profile completeness, recent judgments |

### Profile & CV upload, in detail

- One card per reserved document name from `RESERVED_NAMES` in
  `packages/shared/registry.ts` (`resume`, `constraints`, `background`,
  `preferences`, `judge-prompt`, `quick-judge-prompt`), plus a list of any
  custom text documents the account has stored.
- **`resume` card**: drag-and-drop or click-to-browse PDF uploader.
  Client-side, before the request goes out: reject non-PDF by
  extension/MIME, and enforce `FILE_CAP` (10MB) — both are fast-fail UX only;
  the server's own `beginsLikeAPdf`/`notAPdfRefusal` checks remain the real
  authority and the client-side checks import their limits from
  `packages/shared` rather than redefining them. On successful upload, show
  what the server read back — page count, characters extracted, and the
  `note` field if present — mirroring `sendFile`'s stderr report in the CLI;
  this is the one moment a person learns their PDF might be a scanned image
  with no extractable text.
- **Text document cards** (`constraints`, `background`, `preferences`, and any
  custom names): a textarea with a per-document byte counter against
  `PER_DOCUMENT_CAP` (64KB) and a shared progress bar across all text
  documents against `WHOLE_PROFILE_CAP` (256KB). Saving is an explicit Save
  button, not autosave-on-blur — an accidental autosave over a large
  `background`/`constraints` edit with no undo is a worse failure mode than
  one extra click.
- **`judge-prompt` / `quick-judge-prompt` cards**: a "Reset to default" action
  (mirrors `--default`), and when nothing custom is stored, the shipped
  default text (`DEFAULT_JUDGE_PROMPT` / `DEFAULT_QUICK_JUDGE_PROMPT` from
  `packages/shared`) is shown as placeholder/preview text rather than the
  CLI's stderr note.

### Visual foundation, decided for the search/tabs/judge phase

The "exact visual design system" question this spec originally left open
(see "Out of scope" below) is settled starting with this phase: Tailwind CSS
plus shadcn/ui, added as the first task of the phase and used for every page
built afterward. The existing sign-in and profile pages — built with no
styling at all — are retrofitted to the same primitives in the same task, so
the app reads as one product rather than a styled half and a bare half. No
custom design system beyond shadcn's defaults and whatever color/typography
tokens make the CLI's existing wording (posting cards, coverage sentences,
verdict text) read well on screen.

### Search, Tabs & Judge, in detail

**`/search`** is one page backed by one endpoint, `POST /search` — `list` and
`companies` do not become separate pages:

- Filter bar: free-text search words, plus `country`, `workplace`,
  `employment`, `posted-after`, `unjudged`. A company filter is a
  typeahead/combobox backed by a new `GET /api/companies` route (proxying
  `GET /companies`): typing queries employer names, selecting one adds its id
  to the `company` param. This is the only surface `/companies` needs — there
  is no separate "browse companies" view.
- No explicit "list mode." `pinloop list`'s behavior (date-ordered, no word
  ranking) is just what `/search` already does when the words field is
  empty, and `list`'s narrower option set (no `--company`/`--match`/
  `--order`/`--top`/`--in`/`--semantic`) is simply not shown rather than
  built as a second mode. One query hook (`useSearch`), one results-list
  component.
- Results render as a card per posting (title, company, location/workplace,
  employment, posted date — the same fields `printCard` shows in the CLI),
  each with **Judge** and **Add to tab** actions, plus a checkbox for
  multi-select (**Judge selected**, **Add selected to tab**) since `judge`
  and `tab add` already accept multiple ids server-side. A list header shows
  the coverage/interpretation sentence the CLI writes to stderr
  (`saySearchCoverage`/`interpretationSentence`) as plain on-page text. The
  first shipped version of this renders only the coverage-fraction portion
  of that sentence — the `covered`/`total` numbers every server answer that
  can leave something out carries, shown as "N of M matched" — and not the
  CLI's full semantic-mode wording, ceiling-applies note, or unjudged-postings
  note; porting those word-for-word belongs with the semantic-search slice
  below, once there's a page that actually exercises semantic mode, rather
  than being guessed at ahead of it.
- Pagination is cursor-based "Load more" via `useInfiniteQuery` — not the
  CLI's `--all`/follow-every-page behavior, which has no browser equivalent.
- Semantic search (`--semantic`, `--from-profile`, `--min-match`,
  `--preview`) is out of scope for this phase; `/search` only exposes
  word/filter search. It is expected as a later, separate slice.

**`/tabs`** is two pages:

- `/tabs`: a card per tab (name, description, posting count) with **Open**,
  **Rename**, **Delete**, and a "New tab" form (name + optional description
  → `POST /api/tabs`).
- `/tabs/[name]`: the tab's contents, reusing the same posting-card list
  component `/search` uses, backed by `GET /api/tabs/[name]` (same
  sort/order/limit/cursor and cursor-pagination shape as search). Each card
  gets **Remove from tab** (`POST /api/tabs/[name]/remove`) alongside
  **Judge**. A banner surfaces `no_longer_present` postings the way the CLI
  reports them separately.
- No confirm-gate on any tab route. All of `create`/`list`/`get`/`add`/
  `remove`/`rename`/`delete` are plain queries/mutations, same shape as the
  profile routes already built. Query hooks live in `tab-queries.ts`,
  following `profile-queries.ts`'s `useQuery`/`useMutation` +
  `invalidateQueries(['tabs'])` pattern.
- **This is also when `/search`'s cards get their first real action.**
  `<PostingList>`/`<PostingCard>` (built in the search phase) shipped with an
  unused `renderActions`/`actions` extension point specifically for this: the
  tabs phase wires **Add to tab** into it — a small picker (existing tabs
  fetched via `useTabs`, plus an inline "new tab" field) that calls
  `POST /api/tabs/[name]/add` with the one posting's id. Search's own
  multi-select (**Add selected to tab**) is included the same way, since
  `tab add` already accepts multiple ids server-side. **Judge** stays absent
  from both `/search` and `/tabs/[name]` cards until the judge-dialog phase
  — nothing in this phase renders a Judge action anywhere, even though the
  card component has room for one.

**Judge dialog and the confirm-spend split:**

- `<ConfirmSpendDialog>` is the generic component the top-level
  "confirm-then-spend pattern" section below describes — built once in this
  phase, reused unchanged by `routines`/`schedules`/`watches` later.
  `<JudgeDialog>` is judge-specific: it owns the two-call flow, wraps
  `<ConfirmSpendDialog>` for the confirm step, and owns the live progress
  view after confirmation. It opens from a search card's/tab card's
  **Judge** action (single id) or **Judge selected** (many ids).
- The two `POST /judge` calls are handled differently, not identically:
  - The **first (dry-run)** call carries no `confirm` and is small buffered
    JSON — routed through the existing `callAsAccount`, exactly like every
    other mutation.
  - The **second (confirmed)** call carries `confirm: <token>` and is a real
    judging run, so it is genuinely streamed: `Accept: application/x-ndjson`,
    and `app/api/judge/route.ts` returns the upstream `ReadableStream`
    straight through as the response body instead of buffering it.
- **New proxy primitive**: `callAsAccount` always calls `response.text()`, so
  it cannot serve the streamed call. This phase adds `streamAsAccount` to
  `packages/web/lib/pinloop-server.ts` — same one-shot 401-refresh-and-retry
  as `callAsAccount` (a `Response`'s status/headers are readable before its
  body is consumed, so a 401 can be detected and retried without touching
  the stream), but on success it returns the raw `Response` rather than
  parsed JSON. The route handler re-seals the session cookie on the *outer*
  response before streaming starts if a renewal happened during the retry.
- **Client-side consumption**: a `useJudgeStream` hook does `fetch` plus
  manual `ReadableStream` reading (mirroring `readLines` in `pinloop.ts`),
  splitting on newlines and parsing each line as a `ProgressEvent` from
  `@pinloop/shared`. Events (`call-started`/`thinking`/`verdict`/
  `call-failed`/`error`) are pushed into local component state as they
  arrive and render as a live per-posting progress list; the final line is
  the real answer, resolved as the hook's result — same ordering guarantee
  as the CLI (nothing is held back to check if it's the last line).
  `call-failed`/`error` events render inline against the affected posting
  rather than failing the whole dialog, matching how the CLI keeps going and
  reports per-posting failures.

## The confirm-then-spend pattern

Five actions can spend judgment quota or store something that runs
unattended: `judge`, `routine run`, `schedule put`, `watch put`, `routine
put`. In the CLI these work as two calls — a dry-run that returns a
`confirm_token` plus a full description of what would happen, and a second
call carrying `--confirm <token>` that actually does it. The web app keeps
that exact two-call contract and gives it one shared UI:

- **`<ConfirmSpendDialog>`** is the only place in the app that confirms spend,
  used by all five actions. It renders the server's dry-run response
  (`confirm_token`, `confirm_judgments`, `confirm_left`, `confirm_model`,
  etc. — the same fields `reportConfirmation` in `pinloop.ts` already parses)
  as:
  1. what would actually happen and with which model,
  2. what it would cost and what would be left this month (as text plus a
     small remaining-quota progress bar),
  3. what a real judgment gives that reading the material yourself doesn't
     (judge / routine-run only),
  4. the free alternative (read it yourself; or keep the schedule/watch free
     and judge by hand),
  5. two buttons: **Confirm and spend** and **Cancel**.
- **Flow**: every gated mutation always fires the plain call first. A response
  carrying `confirm_token` resolves the mutation to a "needs confirmation"
  state instead of "done"; the calling page opens `<ConfirmSpendDialog>` with
  that payload. Only "Confirm and spend" re-fires the same mutation with the
  token attached as `confirm` in the request body. No page implements its own
  confirmation UI.
- **Expiry/staleness**: the dialog shows "expires in ~{confirm_token_hours}h."
  If the confirming call is refused (expired, stale, or mismatched token —
  the server-side concern noted against `src/server/confirm.ts` in the CLI's
  comments), the dialog closes with an error toast; the person re-triggers the
  action to get a fresh token rather than the app silently retrying.

## Error handling, versioning & notices

- **Version handling**: a deployed web app has no separately-installed copies
  to fall behind, so there's no "you're out of date, run npm install -g"
  notice to reproduce. The version-header plumbing in the BFF proxy exists
  for a narrower reason: if the backend ever refuses the web app's own client
  version (426-equivalent), show a "please refresh the page" banner. This is
  expected to be rare since redeploying `packages/web` is immediate, unlike an
  installed CLI.
- **Unread messages**: the CLI's forced "read this to the person now" notice
  (aimed at a coding agent relaying on someone's behalf) becomes a small
  badge on an account/inbox icon showing the `pinloop-unread` count, opening a
  plain messages view on click. No forced interruption — a person using the
  UI directly doesn't need a relay instruction.
- **Errors**: the proxy throws a typed error carrying the server's own
  message and status; route handlers turn that into a JSON error body with
  the matching HTTP status. The frontend renders it as an inline form error or
  a toast, using the server's wording as-is — the same discipline the CLI's
  `Failure` class follows today (surface the server's sentence, don't invent
  one).
- **Rate limiting**: the CLI's `Retry-After`-driven countdown becomes a
  disabled action button with a live "retry in Ns" label, driven by the same
  number.

## Testing strategy

- `packages/shared` gains real unit tests for its pure functions (filter
  rules, coverage math, registry validation). This repo currently has none —
  the `*.test.ts` files referenced in its comments live in the private
  monorepo this package was extracted from — so this closes an existing gap
  rather than inheriting a pre-existing test suite.
- `packages/web` gets component/integration tests concentrated on the
  highest-risk flows: the confirm-spend dialog (token round-trip and expiry
  handling), the resume upload flow (PDF validation, size cap, reading back
  the server's page/character report), and — added in the search/tabs/judge
  phase — `streamAsAccount`'s 401-retry-once behavior on a streaming
  response, `/api/judge`'s dual buffered/streamed modes, and
  `<JudgeDialog>`'s progress rendering fed a fake NDJSON stream. Plus
  route-handler tests for the auth refresh-and-retry-once logic generally,
  since that is newly written security-critical code rather than a straight
  port of something already proven.
- The CLI's compiled-output package-boundary test has no equivalent need once
  `packages/cli` is removed; the `packages/web` ↔ `packages/shared` boundary
  is enforced by normal workspace dependency declarations instead.

## Migration / cutover plan

1. Build `packages/web` to full functional parity with `packages/cli`,
   sharing `packages/shared` throughout. `packages/cli` keeps publishing to
   npm unchanged the whole time — no existing user is broken mid-project.
2. Ship the web app; update `README.md` and pinloop.ai to point people at it
   as the primary way to use Pinloop.
3. After a deprecation window, deprecate the npm package (`npm deprecate`)
   and remove `packages/cli` (and any CLI-only code in `packages/shared`, if
   any turns out to exist).

**Open decision, not settled by this design:** the length of the deprecation
window in step 3 is a product/business call, not an architectural one. Set it
before this step is executed; it does not block starting steps 1–2.

## Out of scope for this design

- Redesigning or changing any backend endpoint or response shape.
- Broader branding for `packages/web` beyond the Tailwind/shadcn foundation
  decided in "Visual foundation, decided for the search/tabs/judge phase"
  above (a full brand pass is still a follow-up concern, not this spec).
- Marketing/landing-page content on pinloop.ai outside of pointing existing
  copy at the new web app.

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

**Corrected from the version of this section discussed during brainstorming.**
The original plan assumed the hosted sign-in page could hand the pass back
directly to whatever asked for it. It can't: `src/shared/sign-in.ts` shows the
login service only ever redirects to one fixed, allowlisted address
(`SIGN_IN_SITE_URL` + `CALLBACK_PAGE_PATH`, i.e. `https://pinloop.ai/auth/callback`),
and that page's script only knows how to do one of two things — POST the pass
to a loopback listener on `127.0.0.1` (meaningful only when the thing waiting
for it runs on the *same machine*, which is true for the CLI and not true for
a hosted web app), or display a short code for manual copy-paste
(`HANDOFF_PATH` / `HANDOFF_TRADE_PATH`). Neither was built for "a browser tab
talking to a server it isn't running locally."

- **Sign-in (v1, no backend changes required)**: the web app's "Sign in"
  button opens `https://pinloop.ai/login` in a new tab. The person signs in
  there with Google, GitHub, or an emailed 6-digit code. Finding no loopback
  listener, `pinloop.ai/auth/callback` displays a short code — the same
  fallback UX the CLI already shows when a browser can't reach the terminal
  (`PASTE_THE_CODE_LINE`). The person switches back to the web app's tab and
  pastes that code into a "paste your code" field. The web app's own BFF route
  handler trades it via `POST /auth/handoff/trade` — the exact mechanism
  `tradeTheShortCode` in `pinloop.ts` already implements today — and sets the
  session cookie from the returned pass. One extra copy-paste step versus the
  originally-discussed flow, but it ships without touching anything outside
  this repo.
- **Documented fast-follow, not part of this project**: a seamless flow where
  `pinloop.ai/auth/callback` detects it was opened via `window.open()` (i.e.
  `window.opener` is set) and delivers the pass with
  `window.opener.postMessage(pass, '<web-app-origin>')` instead of showing a
  code. That requires editing the callback page itself, which lives outside
  this repo and needs coordination with whoever owns pinloop.ai. Worth doing
  later; not a blocker for this project.
- **Session storage**: on a successful code trade, the BFF route handler
  (`/api/auth/callback`) that received the `access_token`/`refresh_token` pair
  sets **one httpOnly, Secure, SameSite=Lax session cookie**. No token is ever
  readable by page JavaScript. This is the web equivalent of the CLI's
  `credentials.json` written with `0600` permissions — the goal in both cases
  is "not casually readable by anything else on the machine/in the page."
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
| `/sign-in` | `pinloop login` | `pinloop.ai/login` (new tab), `POST /auth/handoff/trade`, `POST /auth/refresh` |
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
- `packages/web` gets component/integration tests concentrated on the two
  highest-risk flows: the confirm-spend dialog (token round-trip and expiry
  handling) and the resume upload flow (PDF validation, size cap, reading
  back the server's page/character report) — plus route-handler tests for the
  auth refresh-and-retry-once logic, since that is newly written
  security-critical code rather than a straight port of something already
  proven.
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
- The exact visual design system, component library, or branding for
  `packages/web` (a follow-up concern for implementation, not this spec).
- Marketing/landing-page content on pinloop.ai outside of pointing existing
  copy at the new web app.

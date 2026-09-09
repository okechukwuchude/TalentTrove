# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is the published `pinloop` npm package — the command-line client for
Pinloop, a job-search tool meant to be driven by a coding agent on a person's
behalf rather than typed by hand. It is a subset extracted from Pinloop's
larger private monorepo: comments throughout the code reference `src/server/`,
`specs/*.md`, `docs/DECISIONS.md`, `supabase/migrations/`,
`.claude/skills/printed-message/`, `scripts/pack-cli.mjs`, and `*.test.ts`
files that do not exist in this repo. Do not try to find or recreate them —
they live upstream. Treat those references as historical/design context for
*why* the code here is shaped the way it is, not as pointers to files you
should expect to open.

This repo has no test suite and no lint config of its own (`package.json` has
only a `build` script). Correctness is checked by `tsc` and by reading the
code carefully; the enforcement described in comments (package-boundary
tests, prompt-text pinning tests, etc.) runs in the private monorepo this
package is cut from.

## Commands

```
npm install       # install dependencies
npm run build     # tsc; compiles src/ (rootDir) to dist/ (outDir)
```

There is no test script, no lint script, and no dev/watch script defined.
`npx tsc --noEmit` is the quickest way to typecheck without producing `dist/`.

The compiled entry point is `dist/cli/pinloop.js`, wired up via the `bin`
field as the `pinloop` command. To try a local build as a real command:

```
npm run build
npm link          # or: node dist/cli/pinloop.js <args>
```

Useful environment variables for local testing (see `src/cli/paths.ts`):
- `PINLOOP_SERVER_URL` — overrides the server the CLI talks to (default
  `https://api.pinloop.ai`).
- `PINLOOP_CONFIG_DIR` — overrides where the saved login (`credentials.json`)
  is kept (default `~/.pinloop`).

## Architecture

### Two folders, one hard boundary

- `src/cli/` — everything specific to the terminal program: argument parsing
  (`pinloop.ts`, built on `commander`), talking to the hosted server over
  `fetch`, the browser-based login flow (`browser-login.ts`), printing
  (`format.ts`, `rows.ts`, `screen.ts`), and where things are stored on disk
  (`paths.ts`).
- `src/shared/` — logic that both this CLI and the (private) server need, so
  it lives in one place rather than two: filtering rules (`filter.ts`),
  the "N/M" coverage-fraction convention (`coverage.ts`), the reserved
  profile-document registry and default judge prompts (`registry.ts`), the
  guide/instructions builder (`guide.ts`, `guide-text.ts`), the skill/agent
  instruction file text (`skill-file.ts`), sign-in constants (`sign-in.ts`),
  billing text (`billing.ts`), rate/quota limits (`limits.ts`), model-call
  concurrency (`model-calls.ts`), progress-event shapes (`progress-events.ts`),
  and verdict wording (`verdicts.ts`).

**The boundary is load-bearing, not stylistic.** `pinloop.ts`'s header
comment states the rule explicitly: this file and everything it imports must
be importable on their own as a public npm package, so it may only import
from `src/cli/`, `src/shared/`, and `commander` — nothing else. Nothing in
either folder may import from the server. In the upstream monorepo this is
enforced by `src/cli/package-boundary.test.ts` (walking source imports) and
`scripts/pack-cli.mjs` (walking compiled output before publishing); neither
exists in this repo, so when adding code here, hold yourself to the same rule
by inspection — never import server-only modules or introduce a dependency
that isn't published alongside this package.

When something is needed by both the CLI and the server, it belongs in
`src/shared/`, not duplicated in both places or imported across the boundary.

### The CLI's own model: everything is rows, one screen, one server call shape

- **Rows in, rows out.** Every command prints one of two shapes so commands
  can be piped together: with `--json`, stdout is exactly one JSON object
  (a `rows` array, plus `cursor` for paging) and nothing else. Without
  `--json`, stdout is plain lines/columns for a person. Anything that must
  reach a person but must never be swallowed by the next command in a
  pipe — warnings, drop reports, errors, the "new message" notice, the
  "your version is old" notice — goes to stderr instead. `filter` is the one
  verb that touches no network; it only operates on rows another command
  already printed (`src/shared/filter.ts`).
- **One `Screen` (`src/cli/screen.ts`).** All in-progress output ("working…",
  spinners, judge-run progress) is drawn through a single `Screen` built once
  at startup from the real streams. It has two modes decided once at
  startup: `person` (stderr is a TTY: redraw an in-place block of lines) vs.
  `program` (stderr is piped/redirected, or `--plain`: emit flat lines meant
  for a coding agent to store, never erased). It never writes to stdout.
- **One `callServer`/`callAsAccount` path (`src/cli/pinloop.ts`).** Every
  server call goes through `callServer`, which sets the waiting label,
  attaches the CLI version header, reads back the server's
  version/update/unread-message headers, and surfaces the server's own error
  text on failure. `callAsAccount` wraps it with the access-token/refresh-token
  renewal dance: on a 401 it trades the saved refresh token for a new access
  token once and retries the same call once — never more.
- **Saved login is a single file, treated like an SSH key.** `credentials.json`
  under `~/.pinloop` (or `$PINLOOP_CONFIG_DIR`) is written/chmod'd to `0600`
  and refused at read time if its permissions are looser (skipped on Windows,
  where the ACL model differs — see the long comment on `readPass` in
  `pinloop.ts` for why).
- **The confirm-token gate.** Five commands (`judge`, `routine run`,
  `schedule put`, `watch put`, `routine put`) that would spend judgment quota
  or store something automated make a first call that stops short and hands
  back a `confirm_token` describing exactly what *would* happen and what it
  would cost; only a second call carrying `--confirm <token>` actually does
  it. `pinloop.ts` builds the whole next runnable command line for the second
  call (`nextCommandLine`) rather than leaving a coding agent to reconstruct
  it. This logic is entirely in `pinloop.ts` (see the `ConfirmGate` type and
  surrounding functions) since it's about what the CLI tells the *person*,
  not shared with the server.
- **The guide is generated, not hand-written.** `pinloop guide` (and `pinloop
  skill`) are built by `buildGuide` (`src/shared/guide.ts`) walking the real
  command tree Commander constructed and pulling each command's paragraph out
  of `guide-text.ts`. A command added without a matching paragraph throws at
  build time — there is no way to ship an undocumented command.

### Code style notes specific to this repo

The existing code favors long, discursive doc comments that explain *why* a
piece of code is shaped the way it is — often citing a specific date, a
specific person's ("Andrew's") observation at a terminal, or a specific
incident that motivated the design. Several constants and refusal-message
functions are described as pinned by tests in the private monorepo (exact
wording, exact numbers) even though those tests aren't present here — treat
strings like `DEFAULT_JUDGE_PROMPT`, `CLI_VERSION`, and the refusal-message
builders in `registry.ts` as if changing their wording is a deliberate,
cross-repo act, not a casual edit.

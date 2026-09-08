# Monorepo Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert this repo from a single npm package into an npm-workspaces monorepo (`packages/shared`, `packages/cli`, `packages/web`) with zero behavior change to the published `pinloop` CLI, and with Vitest wired up as the test runner every later plan builds on.

**Architecture:** `packages/shared` is a small internal library with one barrel entry point (`src/index.ts`), never published on its own. `packages/cli` is today's `src/cli/` moved as-is; its build step type-checks with `tsc` and then bundles the compiled output together with `@pinloop/shared` into one self-contained `dist/pinloop.js` via esbuild, so the published npm package has no dependency on an unpublished workspace package. `packages/web` is scaffolded as a minimal Next.js app that also depends on `@pinloop/shared`, proving the third package wires up correctly — it has no real pages yet, those come in later plans.

**Tech Stack:** npm workspaces, TypeScript 5.7 (unchanged compiler conventions), esbuild (CLI bundling only), Vitest (testing), Next.js 15 / React 19 (web scaffold only).

**Spec:** `docs/superpowers/specs/2026-09-08-web-app-migration-design.md`

## Global Constraints

- Node `>=22` (from the spec's inherited `engines` field).
- `"type": "module"` (ESM) everywhere — root and every package.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, and the existing modern-module conventions (`moduleResolution: "bundler"`, `allowImportingTsExtensions: true`, `rewriteRelativeImportExtensions: true`) carry over unchanged into every package's tsconfig.
- `npm install -g pinloop` and the `pinloop` command name must keep working exactly as before this project — no functional regression to the published CLI.
- `@pinloop/shared` is a private, unpublished workspace-only package. It must **never** appear under a `dependencies` key of a package that gets published to the npm registry (only `packages/cli`, today, publishes) — only under `devDependencies`, where it's used purely as a build-time input that gets bundled away.

---

### Task 1: Root workspace scaffolding

**Files:**
- Create: `package.json` (replaces the current CLI-only root `package.json` — the CLI's own content moves to `packages/cli/package.json` in Task 3)
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/.gitkeep` (placeholder so the empty directory is visible before Task 2 populates it)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: an npm workspaces root recognizing `packages/*`, a shared `tsconfig.base.json` every package's own `tsconfig.json` will `extends`, and a working `npx vitest run` command that later tasks add real tests under.

- [ ] **Step 1: Move the current root `package.json` out of the way for now**

The current root `package.json` is today's CLI package manifest. Don't delete its content — it becomes `packages/cli/package.json` in Task 3. For now, just note its current dependency versions (already read: `commander ^15.0.0`, `picocolors ^1.1.1`, `log-update ^8.0.0`, `cli-spinners ^3.4.0`, `@types/node ^22.10.2`, `typescript ^5.7.2`) since Task 3 needs them.

- [ ] **Step 2: Write the new root `package.json`**

```json
{
  "name": "pinloop-monorepo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": [
    "packages/shared",
    "packages/cli",
    "packages/web"
  ],
  "scripts": {
    "build": "npm run build -w packages/shared && npm run build -w packages/cli && npm run build -w packages/web",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

`typescript` is declared once here, at the root, and every package's `tsc` invocation resolves it from the hoisted root `node_modules` — no package needs its own copy.

- [ ] **Step 3: Write `tsconfig.base.json`**

This is today's `tsconfig.json` compiler options, minus `outDir`/`rootDir`/`include` (which become per-package in Tasks 2–3, since each package now has its own `src` and `dist`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": false,
    "declaration": false
  }
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create the `packages/` directory and delete the old root `tsconfig.json`**

```bash
mkdir -p packages
touch packages/.gitkeep
rm tsconfig.json
```

(The old `tsconfig.json` is superseded by `tsconfig.base.json` plus each package's own `tsconfig.json` in later tasks. Don't delete the old root `package.json` yet — Task 3 moves its content into `packages/cli/package.json` first, so its dependency versions aren't lost.)

- [ ] **Step 6: Install and verify the workspace resolves**

```bash
npm install
```

Expected: succeeds with no errors, and reports 0 packages found under `packages/*` (there are none yet — that's expected at this point).

```bash
npx vitest run
```

Expected: exits 0, reporting no test files found (there are none yet — this step only proves the Vitest binary and config are wired up correctly before any package depends on it).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts packages/.gitkeep
git rm tsconfig.json
git commit -m "Scaffold npm workspaces root and Vitest config"
```

---

### Task 2: `packages/shared`

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts` (barrel)
- Create: `packages/shared/src/coverage.test.ts`
- Move: `src/shared/*.ts` → `packages/shared/src/*.ts` (14 files: `billing.ts`, `coverage.ts`, `filter.ts`, `guide-text.ts`, `guide.ts`, `limits.ts`, `model-calls.ts`, `progress-events.ts`, `registry.ts`, `sign-in.ts`, `skill-file.ts`, `verdicts.ts`, `version.ts`, `welcome.ts`)

**Interfaces:**
- Consumes: `commander`'s types (only `guide.ts` needs this, as a type-only import: `import type { Command } from 'commander'`).
- Produces: `@pinloop/shared`, a package whose single entry point re-exports every named export of all 14 modules above (`coverageOf`, `type Coverage`, `runFilter`, `type FilterRules`, `type FilterDrop`, `type FilterAnswer`, `cutoffInstant`, `buildGuide`, `NON_COMMAND_PARTS`, `type GuideOptions`, `commandsIn`, `allowanceLines`, `SIGNED_OUT_SENTENCE`, `staleSkillNotice`, `CONFIRM_EXPLANATION`, `GUIDE_TEXT`, `SKILL_TEXT`, `SKILL_VERSION`, `printWelcome`, `RESERVED_NAMES`, `type DocumentKind`, `JUDGE_PROMPT_NAME`, `QUICK_JUDGE_PROMPT_NAME`, `DEFAULT_JUDGE_PROMPT`, `DEFAULT_QUICK_JUDGE_PROMPT`, `reservedKind`, `beginsLikeAPdf`, `NAME_RULE`, `PER_DOCUMENT_CAP`, `WHOLE_PROFILE_CAP`, `FILE_CAP`, `FILE_CONTENT_TYPE`, `DEFAULT_FILE_NAME`, the eight `*Refusal` functions (`nameRuleRefusal`, `wrongKindRefusal`, `holdsTextRefusal`, `overFileCapRefusal`, `notAPdfRefusal`, `willNotOpenRefusal`, `perDocumentRefusal`, `wholeProfileRefusal`), `BILLING_PATH`, `BILLING_TRADE_PATH`, `BILLING_STATUS_PATH`, `STRIPE_NOTICE_PATH`, `STRIPE_SIGNATURE_HEADER`, `UPGRADE_PAGE_PATH`, `UPGRADE_DONE_PAGE_PATH`, `BILLING_CODE_PARAMETER`, `CHECKOUT_PARAMETER`, `BILLING_CODE_LIFETIME_MS`, `BILLING_OPEN_LINE`, `billingLines`, sign-in's constants (`SIGN_IN_SITE_URL`, `SIGN_IN_PAGE_PATH`, `CALLBACK_PAGE_PATH`, `HANDOFF_PATH`, `HANDOFF_TRADE_PATH`, etc.) and functions (`loggedInLine`, `signedOutLine`), `type DeliveredPass`, `MAX_IN_FLIGHT_REQUESTS`, `PROGRESS_CONTENT_TYPE`, `type ProgressEvent`, `VERDICTS`, `type Verdict`, `dropReason`, `rankOf`, `isVersion`, `compareVersions`, `MESSAGES_PER_DAY`, `MAX_MESSAGE_CHARS`, `RATE_LIMIT_REQUESTS`, `PULL_CEILING`) — every consumer imports from the single path `'@pinloop/shared'`.

- [ ] **Step 1: Move the files**

```bash
git mv src/shared packages/shared/src
```

This preserves git history on each file. `packages/shared/src` now holds the 14 `.ts` files, with their existing relative imports (e.g. `filter.ts`'s `import { coverageOf, type Coverage } from './coverage.ts'`) untouched and still valid, since the directory's internal structure didn't change.

- [ ] **Step 2: Write `packages/shared/package.json`**

```json
{
  "name": "@pinloop/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "commander": "^15.0.0"
  }
}
```

`commander` is a devDependency here, not a runtime one: `guide.ts` only imports `Command` as a type (`import type { Command } from 'commander'`), which TypeScript strips out entirely at compile time — it's needed only so `tsc` can resolve the type declaration while building this package. Keep this version number in sync with the real runtime `commander` dependency `packages/cli/package.json` declares in Task 3.

- [ ] **Step 3: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

`declaration: true` (unlike the base config's `false`) because this package is consumed by two other TypeScript projects (`packages/cli`, `packages/web`) that need its `.d.ts` files to type-check against.

- [ ] **Step 4: Write the barrel entry point `packages/shared/src/index.ts`**

```typescript
export * from './billing.ts';
export * from './coverage.ts';
export * from './filter.ts';
export * from './guide-text.ts';
export * from './guide.ts';
export * from './limits.ts';
export * from './model-calls.ts';
export * from './progress-events.ts';
export * from './registry.ts';
export * from './sign-in.ts';
export * from './skill-file.ts';
export * from './verdicts.ts';
export * from './version.ts';
export * from './welcome.ts';
```

- [ ] **Step 5: Install to link the new workspace package**

```bash
npm install
```

Expected: succeeds, and `npm ls --workspaces` now lists `@pinloop/shared`.

- [ ] **Step 6: Build and verify it type-checks**

```bash
npm run build -w packages/shared
```

Expected: exits 0, and `packages/shared/dist/index.js` plus `packages/shared/dist/index.d.ts` now exist alongside a compiled `.js`/`.d.ts` pair for each of the 14 modules.

- [ ] **Step 7: Write a real unit test for `coverageOf`**

This repo currently has zero tests anywhere (the `*.test.ts` files referenced in code comments live in a different, private repo). This is the first real one. Because `coverageOf` already exists and works (it moved, it wasn't written new), there's no red step here — the test is written to pass against already-correct code, not to drive new behavior:

```typescript
// packages/shared/src/coverage.test.ts
import { describe, expect, it } from 'vitest';
import { coverageOf } from './coverage.ts';

describe('coverageOf', () => {
  it('reports how many of a set were covered against the total', () => {
    expect(coverageOf(996, 1000)).toEqual({ covered: 996, total: 1000 });
  });

  it('reports 0/0 when there was nothing to cover', () => {
    expect(coverageOf(0, 0)).toEqual({ covered: 0, total: 0 });
  });

  it('never reduces the fraction', () => {
    expect(coverageOf(249, 250)).toEqual({ covered: 249, total: 250 });
  });
});
```

- [ ] **Step 8: Run the test and verify it passes**

```bash
npx vitest run packages/shared/src/coverage.test.ts
```

Expected: 3 passed, 0 failed.

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "Add packages/shared as an npm workspace, with its first unit test"
```

---

### Task 3: `packages/cli` — move and rewire imports

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Move: `src/cli/*.ts` → `packages/cli/src/*.ts` (7 files: `browser-login.ts`, `format.ts`, `paths.ts`, `pinloop.ts`, `rows.ts`, `screen.ts`, `version.ts`)
- Modify: `packages/cli/src/pinloop.ts` (rewrite its `../shared/*.ts` imports to `@pinloop/shared`)
- Modify: `packages/cli/src/screen.ts` (same)
- Modify: `packages/cli/src/format.ts` (same)
- Modify: `packages/cli/src/browser-login.ts` (same)
- Delete: old root `package.json` and now-empty `src/` directory

**Interfaces:**
- Consumes: `@pinloop/shared`'s exports (specifically: `coverageOf`, `Coverage`, `runFilter`, `FilterRules`, `buildGuide`, `NON_COMMAND_PARTS`, `allowanceLines`, `SIGNED_OUT_SENTENCE`, `SKILL_TEXT`, `SKILL_VERSION`, `printWelcome`, `DEFAULT_FILE_NAME`, `FILE_CONTENT_TYPE`, `JUDGE_PROMPT_NAME`, `QUICK_JUDGE_PROMPT_NAME`, `beginsLikeAPdf`, `reservedKind`, `PROGRESS_CONTENT_TYPE`, `ProgressEvent`, `dropReason`, `compareVersions`, `isVersion`, `ADDRESS_INDENT`, `HANDOFF_TRADE_PATH`, `NO_LOGIN_SAVED_LINE`, `OPEN_THIS_ADDRESS_LINE`, `PASSWORD_FLAGS_REFUSAL`, `PASTE_THE_CODE_LINE`, `loggedInLine`, `signedOutLine`, `DeliveredPass`, `BILLING_PATH`, `billingLines`, `MAX_IN_FLIGHT_REQUESTS`, `GAVE_UP_LINE`, `LOOPBACK_CALLBACK_PATH`, `PORT_PARAMETER`, `SECRET_PARAMETER`, `SIGN_IN_PAGE_PATH`, `SIGN_IN_SITE_URL`, `SIGN_IN_SITE_URL_ENV_VAR`, `WAIT_FOR_SIGN_IN_MS`).
- Produces: `packages/cli/src/*.ts` type-checking cleanly against `@pinloop/shared` built in Task 2, ready for Task 4's bundling step. (No `dist/` yet from this task — `tsc --noEmit` only.)

- [ ] **Step 1: Move the files**

```bash
git mv src/cli packages/cli/src
```

- [ ] **Step 2: Write `packages/cli/package.json`**

This carries over every dependency version from the original root `package.json` unchanged, only reshaping the package metadata for its new location:

```json
{
  "name": "pinloop",
  "version": "0.4.1",
  "description": "The Pinloop command line: enable your coding agent to run your whole job search.",
  "type": "module",
  "bin": {
    "pinloop": "./dist/pinloop.js"
  },
  "homepage": "https://pinloop.ai",
  "scripts": {
    "build": "tsc --noEmit && node scripts/build.mjs",
    "prepack": "npm run build"
  },
  "dependencies": {
    "commander": "^15.0.0",
    "picocolors": "^1.1.1",
    "log-update": "^8.0.0",
    "cli-spinners": "^3.4.0"
  },
  "devDependencies": {
    "@pinloop/shared": "*",
    "@types/node": "^22.10.2",
    "esbuild": "^0.24.0"
  },
  "engines": {
    "node": ">=22"
  },
  "license": "MIT"
}
```

`@pinloop/shared` is under `devDependencies`, never `dependencies` — Task 4's esbuild step inlines its compiled code directly into `dist/pinloop.js`, so the published package never needs to resolve `@pinloop/shared` at install time. Listing it as a real `dependency` would break `npm install -g pinloop` for every real user, since `@pinloop/shared` doesn't exist on the npm registry. `esbuild` and `scripts/build.mjs` are added by Task 4 — this task only needs the manifest shape in place.

The `bin` path changes from `./dist/cli/pinloop.js` to `./dist/pinloop.js` because Task 4's bundler produces one flat file rather than mirroring the old `src/cli/` + `src/shared/` directory split in `dist/`.

- [ ] **Step 3: Write `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Rewrite `packages/cli/src/pinloop.ts`'s shared imports**

Find this block (currently spanning what were lines 73–102, now inside `packages/cli/src/pinloop.ts` unchanged except for its new location):

```typescript
import { coverageOf, type Coverage } from '../shared/coverage.ts';
import { runFilter, type FilterRules } from '../shared/filter.ts';
import { buildGuide, NON_COMMAND_PARTS } from '../shared/guide.ts';
import { allowanceLines, SIGNED_OUT_SENTENCE } from '../shared/guide-text.ts';
import { SKILL_TEXT, SKILL_VERSION } from '../shared/skill-file.ts';
import { printWelcome } from '../shared/welcome.ts';
import {
  DEFAULT_FILE_NAME,
  FILE_CONTENT_TYPE,
  JUDGE_PROMPT_NAME,
  QUICK_JUDGE_PROMPT_NAME,
  beginsLikeAPdf,
  reservedKind,
} from '../shared/registry.ts';
import { PROGRESS_CONTENT_TYPE, type ProgressEvent } from '../shared/progress-events.ts';
import { dropReason } from '../shared/verdicts.ts';
import { compareVersions, isVersion } from '../shared/version.ts';
import {
  ADDRESS_INDENT,
  HANDOFF_TRADE_PATH,
  NO_LOGIN_SAVED_LINE,
  OPEN_THIS_ADDRESS_LINE,
  PASSWORD_FLAGS_REFUSAL,
  PASTE_THE_CODE_LINE,
  loggedInLine,
  signedOutLine,
  type DeliveredPass,
} from '../shared/sign-in.ts';
import { openInBrowser, waitForBrowserSignIn } from './browser-login.ts';
import { BILLING_PATH, billingLines } from '../shared/billing.ts';
import { fractionOf, postingNamed, withSeparators } from './format.ts';
```

Replace it with:

```typescript
import {
  coverageOf,
  type Coverage,
  runFilter,
  type FilterRules,
  buildGuide,
  NON_COMMAND_PARTS,
  allowanceLines,
  SIGNED_OUT_SENTENCE,
  SKILL_TEXT,
  SKILL_VERSION,
  printWelcome,
  DEFAULT_FILE_NAME,
  FILE_CONTENT_TYPE,
  JUDGE_PROMPT_NAME,
  QUICK_JUDGE_PROMPT_NAME,
  beginsLikeAPdf,
  reservedKind,
  PROGRESS_CONTENT_TYPE,
  type ProgressEvent,
  dropReason,
  compareVersions,
  isVersion,
  ADDRESS_INDENT,
  HANDOFF_TRADE_PATH,
  NO_LOGIN_SAVED_LINE,
  OPEN_THIS_ADDRESS_LINE,
  PASSWORD_FLAGS_REFUSAL,
  PASTE_THE_CODE_LINE,
  loggedInLine,
  signedOutLine,
  type DeliveredPass,
  BILLING_PATH,
  billingLines,
} from '@pinloop/shared';
import { openInBrowser, waitForBrowserSignIn } from './browser-login.ts';
import { fractionOf, postingNamed, withSeparators } from './format.ts';
```

Everything else in the file (the remaining local `./`-relative imports for `rows.ts`, `screen.ts`, `version.ts`, `paths.ts`, and every line of actual command logic below the imports) is untouched.

- [ ] **Step 5: Rewrite `packages/cli/src/screen.ts`'s shared imports**

Find:

```typescript
import { withSeparators } from './format.ts';
import { MAX_IN_FLIGHT_REQUESTS } from '../shared/model-calls.ts';
import type { ProgressEvent } from '../shared/progress-events.ts';
```

Replace with:

```typescript
import { withSeparators } from './format.ts';
import { MAX_IN_FLIGHT_REQUESTS, type ProgressEvent } from '@pinloop/shared';
```

- [ ] **Step 6: Rewrite `packages/cli/src/format.ts`'s shared import**

Find:

```typescript
import type { Coverage } from '../shared/coverage.ts';
```

Replace with:

```typescript
import type { Coverage } from '@pinloop/shared';
```

- [ ] **Step 7: Rewrite `packages/cli/src/browser-login.ts`'s shared import**

Find:

```typescript
import {
  GAVE_UP_LINE,
  LOOPBACK_CALLBACK_PATH,
  PORT_PARAMETER,
  SECRET_PARAMETER,
  SIGN_IN_PAGE_PATH,
  SIGN_IN_SITE_URL,
  SIGN_IN_SITE_URL_ENV_VAR,
  WAIT_FOR_SIGN_IN_MS,
  type DeliveredPass,
} from '../shared/sign-in.ts';
```

Replace with:

```typescript
import {
  GAVE_UP_LINE,
  LOOPBACK_CALLBACK_PATH,
  PORT_PARAMETER,
  SECRET_PARAMETER,
  SIGN_IN_PAGE_PATH,
  SIGN_IN_SITE_URL,
  SIGN_IN_SITE_URL_ENV_VAR,
  WAIT_FOR_SIGN_IN_MS,
  type DeliveredPass,
} from '@pinloop/shared';
```

`packages/cli/src/rows.ts`, `packages/cli/src/version.ts`, and `packages/cli/src/paths.ts` import nothing from `shared` at all (confirmed by reading them) — they need no changes here.

- [ ] **Step 8: Remove the now-empty old root `package.json` and `src/` directory**

```bash
git rm package.json
rmdir src 2>/dev/null || true
```

(The old root `package.json`'s content is fully captured in Step 2's `packages/cli/package.json` above — nothing is lost.)

- [ ] **Step 9: Install and type-check**

```bash
npm install
npx tsc --noEmit -p packages/cli
```

Expected: exits 0, no type errors. This confirms every rewritten import in Steps 4–7 resolves correctly against `@pinloop/shared`'s built type declarations from Task 2.

- [ ] **Step 10: Commit**

```bash
git add packages/cli
git commit -m "Move the CLI into packages/cli and rewire its shared imports"
```

---

### Task 4: Bundle `packages/cli` with esbuild

**Files:**
- Create: `packages/cli/scripts/build.mjs`

**Interfaces:**
- Consumes: `packages/cli/src/pinloop.ts` as the bundle entry point; `packages/shared/dist/index.js` (built in Task 2) as the thing being inlined.
- Produces: `packages/cli/dist/pinloop.js`, a single self-contained, executable file with no runtime dependency on `@pinloop/shared` (its code is inlined) but still resolving `commander`, `picocolors`, `log-update`, and `cli-spinners` as real `node_modules` dependencies at runtime, exactly as today.

- [ ] **Step 1: Write `packages/cli/scripts/build.mjs`**

```javascript
import { build } from 'esbuild';

await build({
  entryPoints: ['src/pinloop.ts'],
  outfile: 'dist/pinloop.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // These four are real, published npm dependencies (see package.json) —
  // left external so the bundle doesn't duplicate them; they resolve from
  // node_modules at runtime exactly as they do today.
  external: ['commander', 'picocolors', 'log-update', 'cli-spinners'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
});
```

`@pinloop/shared` is deliberately **not** in the `external` list — that's what makes esbuild inline its compiled code straight into `dist/pinloop.js`, satisfying the Global Constraint that the published package never depends on it at install time.

- [ ] **Step 2: Install esbuild and run the build**

```bash
npm install
npm run build -w packages/cli
```

Expected: `tsc --noEmit` (from Task 3's `package.json` script) exits 0, then esbuild runs and `packages/cli/dist/pinloop.js` is created.

- [ ] **Step 3: Verify the bundle contains the shared code and no bare `@pinloop/shared` import remains**

```bash
grep -c "@pinloop/shared" packages/cli/dist/pinloop.js
```

Expected: `0` — if this is nonzero, the import wasn't inlined and the published package would be broken for real installers.

- [ ] **Step 4: Verify the bundled CLI actually runs**

```bash
node packages/cli/dist/pinloop.js --help
```

Expected: exits 0, prints Commander's usage text (starts with `Usage: pinloop`). This is the concrete proof that bundling didn't silently break anything — a real Node process executing the real published entry point, not just a type-check.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "Bundle packages/cli with esbuild so it publishes with no workspace dependency"
```

---

### Task 5: Scaffold `packages/web`

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/next.config.mjs`
- Create: `packages/web/app/layout.tsx`
- Create: `packages/web/app/page.tsx`

**Interfaces:**
- Consumes: `@pinloop/shared`'s `coverageOf` (just to prove the import resolves from a Next.js build, not because the placeholder page needs it for real).
- Produces: a `packages/web` app buildable with `next build`. No real feature pages — those are Plans 2 and 3.

- [ ] **Step 1: Write `packages/web/package.json`**

```json
{
  "name": "@pinloop/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@pinloop/shared": "*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: Write `packages/web/tsconfig.json`**

Next.js expects a specific tsconfig shape (it rewrites parts of this file the first time `next dev`/`next build` runs, adding a `next-env.d.ts` reference) — this is the standard starting shape for a Next.js 15 App Router project, keeping this monorepo's `strict`/`noUncheckedIndexedAccess` conventions:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `packages/web/next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Write `packages/web/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Pinloop',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Write `packages/web/app/page.tsx`**

```tsx
import { coverageOf } from '@pinloop/shared';

export default function HomePage() {
  const coverage = coverageOf(0, 0);
  return (
    <main>
      <h1>Pinloop</h1>
      <p>
        packages/web is wired up. Shared coverage helper says {coverage.covered}/{coverage.total}.
      </p>
    </main>
  );
}
```

This page exists only to prove `@pinloop/shared` resolves correctly from a Next.js build — it's replaced by the real dashboard in a later plan.

- [ ] **Step 6: Install and build**

```bash
npm install
npm run build -w packages/web
```

Expected: exits 0. Next.js's production build type-checks the whole app and prerenders `/`, so this fails loudly if the `@pinloop/shared` import, the tsconfig, or the JSX is wrong.

- [ ] **Step 7: Commit**

```bash
git add packages/web
git commit -m "Scaffold packages/web as a minimal Next.js app"
```

---

### Task 6: Wire up the root build, end-to-end verification

**Files:**
- Modify: none (this task only runs and verifies what Tasks 1–5 already wrote)

**Interfaces:**
- Consumes: every package built by Tasks 2, 4, and 5.
- Produces: a proven, working `npm run build` from the repo root, and a fresh clone/install path.

- [ ] **Step 1: Clean and rebuild everything from the repo root**

```bash
rm -rf packages/shared/dist packages/cli/dist packages/web/.next node_modules packages/*/node_modules
npm install
npm run build
```

Expected: exits 0. This is the real end-to-end proof — a clean install and build, in the order the root script specifies (`shared` → `cli` → `web`), exactly as a CI pipeline or a fresh contributor's machine would run it.

- [ ] **Step 2: Re-verify the CLI still works after the clean rebuild**

```bash
node packages/cli/dist/pinloop.js --help
```

Expected: exits 0, prints `Usage: pinloop ...`, same as Task 4 Step 4.

- [ ] **Step 3: Re-verify the shared package's tests still pass**

```bash
npm test
```

Expected: the `coverageOf` tests from Task 2 pass (3 passed, 0 failed).

- [ ] **Step 4: Update `.gitignore` for the new per-package build outputs**

Read the current `.gitignore` (today it's just `node_modules/` and `dist/`). Replace it with:

```
node_modules/
packages/*/dist/
packages/web/.next/
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "Verify the monorepo builds end-to-end from a clean install"
```

At this point: `packages/cli` publishes exactly as before (same command name, same behavior, no workspace dependency leaking into its published `dependencies`), `packages/shared` has its first real test coverage, and `packages/web` exists as a proven, buildable foundation for Plan 2 (auth) and Plan 3 (profile/CV upload) to build real pages on.

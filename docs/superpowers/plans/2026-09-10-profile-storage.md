# Profile Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `501`-stubbed `/api/profile` and `/api/profile/[name]`
routes with real implementations backed by our own Postgres — storing the
resume (a PDF file) and every text document (`constraints`, `background`,
`preferences`, `judge-prompt`, `quick-judge-prompt`,
`application-instructions`, and any custom user-named text document).

**Architecture:** One new table, `profile_documents`, keyed by
`(user_id, name)`. A `lib/profile-db.ts` data-access module (mirroring
`lib/auth-db.ts`'s style from the auth+database foundation plan) and a
`lib/pdf.ts` wrapper around `pdf-parse` for resume text-extraction stats.
The two route files get real bodies in place of their `501` stubs, reusing
the naming/size-cap/refusal-wording logic that already exists in
`packages/shared/src/registry.ts` rather than inventing new rules.

**Tech Stack:** Drizzle ORM (already set up by the auth+database
foundation plan — `lib/db.ts`'s `getDb()`, `db/migrate.ts`'s
`runMigrations()`), `pdf-parse` for PDF text extraction, Next.js route
handlers, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-profile-storage-design.md`

## Global Constraints

- `PER_DOCUMENT_CAP` = 65,536 bytes (64KB) — one text document's own size.
- `WHOLE_PROFILE_CAP` = 262,144 bytes (256KB) — every stored text
  document's bytes summed together (file bytes never count toward this).
- `FILE_CAP` = 10,485,760 bytes (10MB) — the resume PDF.
- All three size caps refuse with HTTP `413`. Every other validation
  failure (illegal name, wrong kind, not-a-PDF, won't-open) refuses with
  `400`.
- Every refusal message is the verbatim return value of the matching
  function in `packages/shared/src/registry.ts` (`nameRuleRefusal`,
  `wrongKindRefusal`, `holdsTextRefusal`, `overFileCapRefusal`,
  `notAPdfRefusal`, `willNotOpenRefusal`, `perDocumentRefusal`,
  `wholeProfileRefusal`) — never invent new wording.
- `resume` is the only name ever stored with `kind = 'file'`. Every other
  reserved name, and every custom name, is `kind = 'text'`.
- All new/modified source files use relative imports with an explicit
  `.ts` extension, matching every existing file in `packages/web`.
- Gated (real-database) tests use `describe.skipIf(!process.env.TEST_DATABASE_URL)`.
- A local test Postgres is available at
  `postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test`.
  Environment variables set with `export` do NOT persist between separate
  shell invocations in this harness — set `TEST_DATABASE_URL`/`DATABASE_URL`
  inline on the same command line every time you run a gated test.

---

### Task 1: `profile_documents` schema and migration

**Files:**
- Modify: `packages/web/db/schema.ts`
- Test: `packages/web/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing new (uses Drizzle's `pgTable`/`customType`, no other
  task's code).
- Produces: `profileDocuments` (Drizzle table), columns `userId`, `name`,
  `kind`, `textContent`, `fileBytes`, `bytes`, `originalFilename`,
  `updatedAt`.

Drizzle's `pg-core` has no built-in `bytea` column type in the version
this repo uses — it's defined via `customType`.

- [ ] **Step 1: Add the table to the schema**

Add to `packages/web/db/schema.ts` (keep the existing `users`/`sessions`/
`passwordResetTokens` tables exactly as they are; add this alongside
them, and add `customType` to the existing `drizzle-orm/pg-core` import
line):

```ts
import { customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
```

```ts
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const profileDocuments = pgTable(
  'profile_documents',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // 'text' | 'file'
    textContent: text('text_content'), // set when kind = 'text'
    fileBytes: bytea('file_bytes'), // set when kind = 'file' — the resume PDF
    bytes: integer('bytes').notNull(),
    originalFilename: text('original_filename'), // set when kind = 'file'
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.name] })],
);
```

Add `primaryKey` to the same `drizzle-orm/pg-core` import line alongside
`customType`.

- [ ] **Step 2: Generate the migration**

```bash
cd packages/web
npx drizzle-kit generate
```

Confirm a new `packages/web/db/migrations/0001_*.sql` file was created,
containing `CREATE TABLE "profile_documents"` with a composite primary
key on `(user_id, name)` and a `file_bytes` column of type `bytea`.

- [ ] **Step 3: Write the failing test**

Add to `packages/web/db/schema.test.ts`, inside the existing
`describe.skipIf(!testDatabaseUrl)` block (reuse the same `beforeAll`
that already calls `runMigrations`):

```ts
it('creates profile_documents', async () => {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public'
    and table_name = 'profile_documents'
  `;
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run db/schema.test.ts
```

Expected: FAIL (or SKIPPED without `TEST_DATABASE_URL`) — before Step 2's
migration exists, `information_schema.tables` has no `profile_documents`
row.

- [ ] **Step 5: Run it to verify it passes**

Same command as Step 4. Expected: PASS (2 tests total in the file now).

- [ ] **Step 6: Commit**

```bash
git add packages/web/db/schema.ts packages/web/db/schema.test.ts packages/web/db/migrations/
git commit -m "web: add profile_documents table"
```

---

### Task 2: PDF text-extraction wrapper

**Files:**
- Modify: `packages/web/package.json` (new dependencies)
- Create: `packages/web/lib/pdf.ts`
- Test: `packages/web/lib/pdf.test.ts`

**Interfaces:**
- Produces: `parseResumePdf(bytes: Buffer): Promise<{pages: number; pagesRead: number; characters: number; note?: string}>`.

This task needs no database — it's pure, testable with real (small,
hand-built) PDF byte fixtures, no mocking.

- [ ] **Step 1: Install dependencies**

```bash
npm install pdf-parse -w packages/web
npm install -D @types/pdf-parse -w packages/web
```

- [ ] **Step 2: Write the failing test**

Create `packages/web/lib/pdf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseResumePdf } from './pdf.ts';

// A minimal, hand-built, valid single-page PDF with one line of real text
// ("Hello resume") drawn via a content stream — small enough to inline,
// and exercises a genuine text-extraction path rather than a mock.
const PDF_WITH_TEXT = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 200 200]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 52>>
stream
BT /F1 24 Tf 10 100 Td (Hello resume) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
trailer<</Size 6/Root 1 0 R>>
startxref
0
%%EOF`,
  'latin1',
);

// Same shape, but an empty content stream — a valid, openable PDF with no
// extractable text at all (the "scanned image" case).
const PDF_WITH_NO_TEXT = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<<>>/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj
4 0 obj<</Length 0>>
stream
endstream
endobj
xref
0 5
0000000000 65535 f 
trailer<</Size 5/Root 1 0 R>>
startxref
0
%%EOF`,
  'latin1',
);

describe('parseResumePdf', () => {
  it('extracts text and reports page/character counts for a PDF with a text layer', async () => {
    const result = await parseResumePdf(PDF_WITH_TEXT);
    expect(result.pages).toBe(1);
    expect(result.pagesRead).toBe(1);
    expect(result.characters).toBeGreaterThan(0);
    expect(result.note).toBeUndefined();
  });

  it('reports zero characters and a note for a PDF with no extractable text', async () => {
    const result = await parseResumePdf(PDF_WITH_NO_TEXT);
    expect(result.pages).toBe(1);
    expect(result.pagesRead).toBe(0);
    expect(result.characters).toBe(0);
    expect(result.note).toBe('this file may be a scanned image with no extractable text');
  });

  it('rejects a file that does not parse as a PDF at all', async () => {
    const notAPdf = Buffer.from('this is not a pdf file');
    await expect(parseResumePdf(notAPdf)).rejects.toThrow();
  });
});
```

**If the two hand-built PDF fixtures above don't parse cleanly** when you
actually run this against the real `pdf-parse` package (their `xref`
byte offsets are deliberately not computed precisely — `pdf-parse`/
`pdfjs-dist` is normally tolerant of this and recovers by scanning the
file for objects, but confirm this for real rather than assuming it):
this is a legitimate thing to discover in the RED step. Fix the fixture
(e.g. compute the real byte offset of each `N 0 obj` in the string and
put correct offsets in the `xref` table) until it parses correctly — do
not weaken the test's assertions to work around a broken fixture.

- [ ] **Step 3: Run it to verify it fails**

```bash
cd packages/web
npx vitest run lib/pdf.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `packages/web/lib/pdf.ts`:

```ts
import pdfParse from 'pdf-parse';

export type ParsedResume = {
  pages: number;
  pagesRead: number;
  characters: number;
  note?: string;
};

const NO_TEXT_NOTE = 'this file may be a scanned image with no extractable text';

export async function parseResumePdf(bytes: Buffer): Promise<ParsedResume> {
  const data = await pdfParse(bytes);
  const characters = data.text.length;
  const pages = data.numpages;
  const pagesRead = characters > 0 ? pages : 0;
  return {
    pages,
    pagesRead,
    characters,
    ...(characters === 0 ? { note: NO_TEXT_NOTE } : {}),
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
cd packages/web
npx vitest run lib/pdf.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/lib/pdf.ts packages/web/lib/pdf.test.ts
git commit -m "web: add PDF text-extraction wrapper for resume uploads"
```

---

### Task 3: `profile-db.ts` data access layer

**Files:**
- Create: `packages/web/lib/profile-db.ts`
- Test: `packages/web/lib/profile-db.test.ts`

**Interfaces:**
- Consumes: `getDb` (`lib/db.ts`), `profileDocuments`/`users` (`db/schema.ts`).
- Produces:
  - `type ProfileDocumentSummary = {name: string; kind: 'text' | 'file'; bytes: number; updatedAt: Date; originalFilename: string | null}`
  - `type ProfileDocumentDetail = ProfileDocumentSummary & {textContent: string | null}`
  - `listProfileDocuments(userId: string): Promise<ProfileDocumentSummary[]>`
  - `getProfileDocument(userId: string, name: string): Promise<ProfileDocumentDetail | null>`
  - `upsertTextDocument(userId: string, name: string, text: string): Promise<ProfileDocumentSummary>`
  - `upsertFileDocument(userId: string, name: string, bytes: Buffer, originalFilename: string): Promise<ProfileDocumentSummary>`
  - `deleteProfileDocument(userId: string, name: string): Promise<void>`
  - `sumOtherTextBytes(userId: string, excludingName: string): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `packages/web/lib/profile-db.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('profile-db', () => {
  let authDb: typeof import('./auth-db.ts');
  let profileDb: typeof import('./profile-db.ts');
  let sql: ReturnType<typeof postgres>;
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    profileDb = await import('./profile-db.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from profile_documents`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function freshUserId(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    return user.id;
  }

  it('returns an empty list for a user with no documents', async () => {
    userId = await freshUserId();
    expect(await profileDb.listProfileDocuments(userId)).toEqual([]);
  });

  it('stores and retrieves a text document', async () => {
    userId = await freshUserId();
    const summary = await profileDb.upsertTextDocument(userId, 'constraints', 'must be remote');
    expect(summary).toMatchObject({ name: 'constraints', kind: 'text', bytes: 14, originalFilename: null });

    const detail = await profileDb.getProfileDocument(userId, 'constraints');
    expect(detail).toMatchObject({ name: 'constraints', kind: 'text', textContent: 'must be remote' });

    const list = await profileDb.listProfileDocuments(userId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'constraints', kind: 'text' });
  });

  it('upserting the same name replaces the stored value', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'first version');
    await profileDb.upsertTextDocument(userId, 'background', 'second version, longer');

    const detail = await profileDb.getProfileDocument(userId, 'background');
    expect(detail?.textContent).toBe('second version, longer');
    expect(await profileDb.listProfileDocuments(userId)).toHaveLength(1);
  });

  it('stores and retrieves a file document', async () => {
    userId = await freshUserId();
    const bytes = Buffer.from('%PDF-1.4 fake pdf bytes for this test');
    const summary = await profileDb.upsertFileDocument(userId, 'resume', bytes, 'my-resume.pdf');
    expect(summary).toMatchObject({
      name: 'resume',
      kind: 'file',
      bytes: bytes.length,
      originalFilename: 'my-resume.pdf',
    });

    const detail = await profileDb.getProfileDocument(userId, 'resume');
    expect(detail).toMatchObject({ name: 'resume', kind: 'file', originalFilename: 'my-resume.pdf' });
  });

  it('returns null for a document that was never stored', async () => {
    userId = await freshUserId();
    expect(await profileDb.getProfileDocument(userId, 'nothing-here')).toBeNull();
  });

  it('deletes a document, and deleting an unset one is a no-op', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'preferences', 'remote only');
    await profileDb.deleteProfileDocument(userId, 'preferences');
    expect(await profileDb.getProfileDocument(userId, 'preferences')).toBeNull();

    await profileDb.deleteProfileDocument(userId, 'never-stored');
  });

  it('sumOtherTextBytes excludes the named document and file documents', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'a'.repeat(10));
    await profileDb.upsertTextDocument(userId, 'preferences', 'b'.repeat(20));
    await profileDb.upsertFileDocument(userId, 'resume', Buffer.from('c'.repeat(1000)), 'r.pdf');

    expect(await profileDb.sumOtherTextBytes(userId, 'background')).toBe(20);
    expect(await profileDb.sumOtherTextBytes(userId, 'preferences')).toBe(10);
    expect(await profileDb.sumOtherTextBytes(userId, 'something-else')).toBe(30);
  });

  it('sumOtherTextBytes does not double-count when re-saving the same document', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'a'.repeat(100));
    const before = await profileDb.sumOtherTextBytes(userId, 'background');
    await profileDb.upsertTextDocument(userId, 'background', 'a'.repeat(500));
    const after = await profileDb.sumOtherTextBytes(userId, 'background');
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it('documents are scoped per user', async () => {
    const userA = await freshUserId();
    const userB = await freshUserId();
    await profileDb.upsertTextDocument(userA, 'background', 'user A background');
    expect(await profileDb.getProfileDocument(userB, 'background')).toBeNull();
  });
});
```

Note this test file has no `beforeEach` — every test calls
`freshUserId()` itself rather than sharing per-test setup, since each
test needs a differently-scoped user (or two, for the cross-user
isolation test).

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run lib/profile-db.test.ts
```

Expected: FAIL (or SKIPPED) — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/web/lib/profile-db.ts`:

```ts
import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from './db.ts';
import { profileDocuments } from '../db/schema.ts';

export type ProfileDocumentSummary = {
  name: string;
  kind: 'text' | 'file';
  bytes: number;
  updatedAt: Date;
  originalFilename: string | null;
};

export type ProfileDocumentDetail = ProfileDocumentSummary & {
  textContent: string | null;
};

const SUMMARY_COLUMNS = {
  name: profileDocuments.name,
  kind: profileDocuments.kind,
  bytes: profileDocuments.bytes,
  updatedAt: profileDocuments.updatedAt,
  originalFilename: profileDocuments.originalFilename,
} as const;

function asSummary(row: {
  name: string;
  kind: string;
  bytes: number;
  updatedAt: Date;
  originalFilename: string | null;
}): ProfileDocumentSummary {
  return { ...row, kind: row.kind as 'text' | 'file' };
}

export async function listProfileDocuments(userId: string): Promise<ProfileDocumentSummary[]> {
  const rows = await getDb()
    .select(SUMMARY_COLUMNS)
    .from(profileDocuments)
    .where(eq(profileDocuments.userId, userId))
    .orderBy(profileDocuments.name);
  return rows.map(asSummary);
}

export async function getProfileDocument(userId: string, name: string): Promise<ProfileDocumentDetail | null> {
  const [row] = await getDb()
    .select({ ...SUMMARY_COLUMNS, textContent: profileDocuments.textContent })
    .from(profileDocuments)
    .where(and(eq(profileDocuments.userId, userId), eq(profileDocuments.name, name)));
  if (!row) return null;
  return { ...asSummary(row), textContent: row.textContent };
}

export async function upsertTextDocument(
  userId: string,
  name: string,
  text: string,
): Promise<ProfileDocumentSummary> {
  const bytes = Buffer.byteLength(text, 'utf8');
  const [row] = await getDb()
    .insert(profileDocuments)
    .values({ userId, name, kind: 'text', textContent: text, bytes, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [profileDocuments.userId, profileDocuments.name],
      set: { kind: 'text', textContent: text, fileBytes: null, originalFilename: null, bytes, updatedAt: new Date() },
    })
    .returning(SUMMARY_COLUMNS);
  return asSummary(row!);
}

export async function upsertFileDocument(
  userId: string,
  name: string,
  bytes: Buffer,
  originalFilename: string,
): Promise<ProfileDocumentSummary> {
  const [row] = await getDb()
    .insert(profileDocuments)
    .values({
      userId,
      name,
      kind: 'file',
      fileBytes: bytes,
      bytes: bytes.length,
      originalFilename,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [profileDocuments.userId, profileDocuments.name],
      set: {
        kind: 'file',
        textContent: null,
        fileBytes: bytes,
        bytes: bytes.length,
        originalFilename,
        updatedAt: new Date(),
      },
    })
    .returning(SUMMARY_COLUMNS);
  return asSummary(row!);
}

export async function deleteProfileDocument(userId: string, name: string): Promise<void> {
  await getDb()
    .delete(profileDocuments)
    .where(and(eq(profileDocuments.userId, userId), eq(profileDocuments.name, name)));
}

export async function sumOtherTextBytes(userId: string, excludingName: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${profileDocuments.bytes}), 0)` })
    .from(profileDocuments)
    .where(
      and(
        eq(profileDocuments.userId, userId),
        eq(profileDocuments.kind, 'text'),
        ne(profileDocuments.name, excludingName),
      ),
    );
  return Number(row?.total ?? 0);
}
```

`sumOtherTextBytes` casts the SQL `sum(...)` result through `sql<string>`
and then `Number(...)`, because Postgres aggregate sums can come back from
the driver as a string rather than a native number — returning a string
type from the query and converting explicitly avoids a silent precision
bug if the driver's numeric-decoding behavior ever changes.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run lib/profile-db.test.ts
```

Expected: PASS (9 tests), or SKIPPED without `TEST_DATABASE_URL`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/profile-db.ts packages/web/lib/profile-db.test.ts
git commit -m "web: add profile-db data access layer"
```

---

### Task 4: `GET /api/profile` (list)

**Files:**
- Modify: `packages/web/app/api/profile/route.ts`
- Modify: `packages/web/app/api/profile/route.test.ts`

**Interfaces:**
- Consumes: `requireSession` (`lib/require-session.ts`), `listProfileDocuments` (`lib/profile-db.ts`, Task 3).

- [ ] **Step 1: Write the failing test**

Replace `packages/web/app/api/profile/route.test.ts` entirely:

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe.skipIf(!testDatabaseUrl)('GET /api/profile', () => {
  let authDb: typeof import('../../../lib/auth-db.ts');
  let profileDb: typeof import('../../../lib/profile-db.ts');
  let GET: typeof import('./route.ts')['GET'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../lib/auth-db.ts');
    profileDb = await import('../../../lib/profile-db.ts');
    ({ GET } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from profile_documents`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<{ cookie: string; userId: string }> {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return { cookie: sessionCookieHeader(sealed).split(';')[0]!, userId: user.id };
  }

  it('returns 401 when not signed in', async () => {
    const response = await GET(new Request('http://localhost/api/profile'));
    expect(response.status).toBe(401);
  });

  it('returns an empty list for a signed-in account with nothing stored', async () => {
    const { cookie } = await signedInCookie();
    const response = await GET(new Request('http://localhost/api/profile', { headers: { cookie } }));
    expect(await response.json()).toEqual({ rows: [] });
  });

  it('returns stored documents in the shape the frontend expects', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'constraints', 'must be remote');
    await profileDb.upsertFileDocument(userId, 'resume', Buffer.from('%PDF-1.4 fake'), 'my-resume.pdf');

    const response = await GET(new Request('http://localhost/api/profile', { headers: { cookie } }));
    const body = (await response.json()) as { rows: Record<string, unknown>[] };
    expect(body.rows).toHaveLength(2);

    const constraints = body.rows.find((row) => row.name === 'constraints');
    expect(constraints).toMatchObject({ name: 'constraints', kind: 'text', bytes: 14 });
    expect(typeof constraints?.updated_at).toBe('string');

    const resume = body.rows.find((row) => row.name === 'resume');
    expect(resume).toMatchObject({ name: 'resume', kind: 'file', original_filename: 'my-resume.pdf' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run app/api/profile/route.test.ts
```

Expected: FAIL (or SKIPPED) — the current route returns the `501` stub
body regardless of the request, so the second and third tests' assertions
on `{rows: [...]}` fail.

- [ ] **Step 3: Write the implementation**

Replace `packages/web/app/api/profile/route.ts` entirely:

```ts
import { listProfileDocuments } from '../../../lib/profile-db.ts';
import { requireSession } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const rows = await listProfileDocuments(auth.user.userId);
  return Response.json({
    rows: rows.map((row) => ({
      name: row.name,
      kind: row.kind,
      bytes: row.bytes,
      updated_at: row.updatedAt.toISOString(),
      ...(row.originalFilename ? { original_filename: row.originalFilename } : {}),
    })),
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run app/api/profile/route.test.ts
```

Expected: PASS (3 tests), or SKIPPED.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/profile/route.ts packages/web/app/api/profile/route.test.ts
git commit -m "web: implement GET /api/profile"
```

---

### Task 5: `GET /api/profile/[name]` (text detail)

**Files:**
- Modify: `packages/web/app/api/profile/[name]/route.ts` (only the `GET` export — `POST`/`DELETE` still return the `501` stub until Tasks 6 and 7)
- Modify: `packages/web/app/api/profile/[name]/route.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `getProfileDocument` (`lib/profile-db.ts`, Task 3), and from `@talenttrove/shared`: `JUDGE_PROMPT_NAME`, `DEFAULT_JUDGE_PROMPT`, `QUICK_JUDGE_PROMPT_NAME`, `DEFAULT_QUICK_JUDGE_PROMPT`, `wrongKindRefusal`.

- [ ] **Step 1: Write the failing test**

Replace `packages/web/app/api/profile/[name]/route.test.ts` entirely
(this file currently tests all three methods against the `501` stub — the
new version tests only `GET`; Tasks 6 and 7 extend this same file for
`POST`/`DELETE`):

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const params = (name: string) => ({ params: Promise.resolve({ name }) });

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe.skipIf(!testDatabaseUrl)('GET /api/profile/[name]', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let profileDb: typeof import('../../../../lib/profile-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    profileDb = await import('../../../../lib/profile-db.ts');
    route = await import('./route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from profile_documents`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<{ cookie: string; userId: string }> {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return { cookie: sessionCookieHeader(sealed).split(';')[0]!, userId: user.id };
  }

  it('returns 401 when not signed in', async () => {
    const response = await route.GET(new Request('http://localhost/api/profile/constraints'), params('constraints'));
    expect(response.status).toBe(401);
  });

  it('returns the stored text when a document is set', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'constraints', 'must be remote');

    const response = await route.GET(
      new Request('http://localhost/api/profile/constraints', { headers: { cookie } }),
      params('constraints'),
    );
    expect(await response.json()).toEqual({ text: 'must be remote', stored: true });
  });

  it('returns an empty string for an unset name with no shipped default', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.GET(
      new Request('http://localhost/api/profile/background', { headers: { cookie } }),
      params('background'),
    );
    expect(await response.json()).toEqual({ text: '', stored: false });
  });

  it('returns the shipped default text for an unset judge-prompt', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.GET(
      new Request('http://localhost/api/profile/judge-prompt', { headers: { cookie } }),
      params('judge-prompt'),
    );
    const body = (await response.json()) as { text: string; stored: boolean };
    expect(body.stored).toBe(false);
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text).toContain('constraints');
  });

  it('returns the shipped default text for an unset quick-judge-prompt', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.GET(
      new Request('http://localhost/api/profile/quick-judge-prompt', { headers: { cookie } }),
      params('quick-judge-prompt'),
    );
    const body = (await response.json()) as { text: string; stored: boolean };
    expect(body.stored).toBe(false);
    expect(body.text.length).toBeGreaterThan(0);
  });

  it('refuses to return a file document as text', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertFileDocument(userId, 'resume', Buffer.from('%PDF-1.4 fake'), 'r.pdf');

    const response = await route.GET(
      new Request('http://localhost/api/profile/resume', { headers: { cookie } }),
      params('resume'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/holds a file, not text/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run "app/api/profile/[name]/route.test.ts"
```

Expected: FAIL (or SKIPPED) — the current file only exports the `501`
stub for all three methods, so `route.POST`/`route.DELETE` referenced
nowhere yet is fine, but `GET`'s behavior doesn't match any of these
assertions.

- [ ] **Step 3: Write the implementation**

Replace `packages/web/app/api/profile/[name]/route.ts` entirely with this
(the `POST`/`DELETE` `501` stubs stay exactly as they are for now — Tasks
6 and 7 replace them):

```ts
import {
  DEFAULT_JUDGE_PROMPT,
  DEFAULT_QUICK_JUDGE_PROMPT,
  JUDGE_PROMPT_NAME,
  QUICK_JUDGE_PROMPT_NAME,
  wrongKindRefusal,
} from '@talenttrove/shared';
import { getProfileDocument } from '../../../../lib/profile-db.ts';
import { requireSession } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  const row = await getProfileDocument(auth.user.userId, name);
  if (row) {
    if (row.kind === 'file') {
      return Response.json({ error: wrongKindRefusal(name) }, { status: 400 });
    }
    return Response.json({ text: row.textContent ?? '', stored: true });
  }

  if (name === JUDGE_PROMPT_NAME) return Response.json({ text: DEFAULT_JUDGE_PROMPT, stored: false });
  if (name === QUICK_JUDGE_PROMPT_NAME) return Response.json({ text: DEFAULT_QUICK_JUDGE_PROMPT, stored: false });
  return Response.json({ text: '', stored: false });
}

export async function POST(request: Request, _params: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'profile storage is not built yet' }, { status: 501 });
}

export async function DELETE(request: Request, _params: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'profile storage is not built yet' }, { status: 501 });
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run "app/api/profile/[name]/route.test.ts"
```

Expected: PASS (7 tests), or SKIPPED.

- [ ] **Step 5: Commit**

```bash
git add "packages/web/app/api/profile/[name]/route.ts" "packages/web/app/api/profile/[name]/route.test.ts"
git commit -m "web: implement GET /api/profile/[name]"
```

---

### Task 6: `POST /api/profile/[name]` (text and file)

**Files:**
- Modify: `packages/web/app/api/profile/[name]/route.ts` (only the `POST` export)
- Modify: `packages/web/app/api/profile/[name]/route.test.ts` (append)

**Interfaces:**
- Consumes: `requireSession`, `upsertTextDocument`/`upsertFileDocument`/`sumOtherTextBytes` (Task 3), `parseResumePdf` (Task 2), and from `@talenttrove/shared`: `FILE_CAP`, `PER_DOCUMENT_CAP`, `WHOLE_PROFILE_CAP`, `NAME_RULE`, `reservedKind`, `beginsLikeAPdf`, `nameRuleRefusal`, `wrongKindRefusal`, `holdsTextRefusal`, `overFileCapRefusal`, `notAPdfRefusal`, `willNotOpenRefusal`, `perDocumentRefusal`, `wholeProfileRefusal`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/app/api/profile/[name]/route.test.ts`, as a new
top-level `describe.skipIf(!testDatabaseUrl)('POST /api/profile/[name]', ...)`
block with its own `beforeAll`/`afterEach`/`afterAll`/`signedInCookie`
identical in shape to the `GET` block above (repeat that same
boilerplate — this is a separate `describe` block in the same file, not
a shared fixture, matching how the auth-database-foundation plan's test
files are structured):

```ts
describe.skipIf(!testDatabaseUrl)('POST /api/profile/[name]', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let profileDb: typeof import('../../../../lib/profile-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    profileDb = await import('../../../../lib/profile-db.ts');
    route = await import('./route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from profile_documents`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<{ cookie: string; userId: string }> {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return { cookie: sessionCookieHeader(sealed).split(';')[0]!, userId: user.id };
  }

  it('returns 401 when not signed in', async () => {
    const response = await route.POST(
      new Request('http://localhost/api/profile/constraints', { method: 'POST' }),
      params('constraints'),
    );
    expect(response.status).toBe(401);
  });

  it('stores a text document', async () => {
    const { cookie, userId } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/constraints', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'must be remote' }),
      }),
      params('constraints'),
    );
    expect(await response.json()).toEqual({ text: 'must be remote', stored: true });

    const detail = await profileDb.getProfileDocument(userId, 'constraints');
    expect(detail?.textContent).toBe('must be remote');
  });

  it('rejects an illegal custom document name', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/Not A Legal Name', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x' }),
      }),
      params('Not A Legal Name'),
    );
    expect(response.status).toBe(400);
  });

  it('accepts a legal custom document name', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/my-notes', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a custom note' }),
      }),
      params('my-notes'),
    );
    expect(response.status).toBe(200);
  });

  it('refuses text sent to resume (the file-kind name)', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/resume', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'not a pdf' }),
      }),
      params('resume'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/holds a file, not text/i);
  });

  it('refuses a PDF sent to a text-kind name', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/constraints', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: Buffer.from('%PDF-1.4 fake'),
      }),
      params('constraints'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/holds text, not a file/i);
  });

  it('refuses a text document over the per-document cap', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/background', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(70_000) }),
      }),
      params('background'),
    );
    expect(response.status).toBe(413);
  });

  it('refuses a text document that would push the whole profile over its cap', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'background', 'x'.repeat(60_000));
    await profileDb.upsertTextDocument(userId, 'preferences', 'x'.repeat(60_000));
    await profileDb.upsertTextDocument(userId, 'application-instructions', 'x'.repeat(60_000));
    await profileDb.upsertTextDocument(userId, 'judge-prompt', 'x'.repeat(60_000));

    const response = await route.POST(
      new Request('http://localhost/api/profile/quick-judge-prompt', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(30_000) }),
      }),
      params('quick-judge-prompt'),
    );
    expect(response.status).toBe(413);
  });

  it('re-saving the same text document at a smaller size never trips the whole-profile cap', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'background', 'x'.repeat(200_000));

    const response = await route.POST(
      new Request('http://localhost/api/profile/background', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'much shorter now' }),
      }),
      params('background'),
    );
    expect(response.status).toBe(200);
  });

  it('rejects a PDF over the file cap', async () => {
    const { cookie } = await signedInCookie();
    const oversized = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(10 * 1024 * 1024 + 1, 'a')]);
    const response = await route.POST(
      new Request('http://localhost/api/profile/resume?filename=big.pdf', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: oversized,
      }),
      params('resume'),
    );
    expect(response.status).toBe(413);
  });

  it('rejects a file that does not begin like a PDF', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/resume?filename=fake.pdf', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: Buffer.from('not a real pdf header'),
      }),
      params('resume'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/%PDF-/);
  });

  it('stores a valid resume PDF and reports parse stats', async () => {
    const { cookie, userId } = await signedInCookie();
    // The same minimal-but-valid PDF-with-text fixture from lib/pdf.test.ts.
    const validPdf = Buffer.from(
      `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 200 200]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 52>>
stream
BT /F1 24 Tf 10 100 Td (Hello resume) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
trailer<</Size 6/Root 1 0 R>>
startxref
0
%%EOF`,
      'latin1',
    );

    const response = await route.POST(
      new Request('http://localhost/api/profile/resume?filename=my-resume.pdf', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: validPdf,
      }),
      params('resume'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'resume', kind: 'file', original_filename: 'my-resume.pdf' });
    expect(body.pages).toBe(1);
    expect((body.characters as number)).toBeGreaterThan(0);

    const stored = await profileDb.getProfileDocument(userId, 'resume');
    expect(stored?.originalFilename).toBe('my-resume.pdf');
  });
});
```

If the inline `validPdf` fixture here needed adjustment in Task 2 to
actually parse, use the exact same corrected bytes here too — the two
must stay identical, since they're testing the same underlying parser.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run "app/api/profile/[name]/route.test.ts"
```

Expected: FAIL (or SKIPPED) — `POST` still returns the `501` stub.

- [ ] **Step 3: Write the implementation**

Replace only the `POST` export in
`packages/web/app/api/profile/[name]/route.ts` (leave `GET` from Task 5
and the `DELETE` `501` stub untouched; update the import block at the top
to add the new names):

```ts
import {
  DEFAULT_JUDGE_PROMPT,
  DEFAULT_QUICK_JUDGE_PROMPT,
  FILE_CAP,
  JUDGE_PROMPT_NAME,
  NAME_RULE,
  PER_DOCUMENT_CAP,
  QUICK_JUDGE_PROMPT_NAME,
  WHOLE_PROFILE_CAP,
  beginsLikeAPdf,
  holdsTextRefusal,
  nameRuleRefusal,
  notAPdfRefusal,
  overFileCapRefusal,
  perDocumentRefusal,
  reservedKind,
  willNotOpenRefusal,
  wholeProfileRefusal,
  wrongKindRefusal,
} from '@talenttrove/shared';
import { parseResumePdf } from '../../../../lib/pdf.ts';
import {
  getProfileDocument,
  sumOtherTextBytes,
  upsertFileDocument,
  upsertTextDocument,
} from '../../../../lib/profile-db.ts';
import { requireSession } from '../../../../lib/require-session.ts';
```

```ts
function kindFor(name: string): 'text' | 'file' {
  return reservedKind(name) ?? 'text';
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  if (!reservedKind(name) && !NAME_RULE.test(name)) {
    return Response.json({ error: nameRuleRefusal(name) }, { status: 400 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  const isFileUpload = contentType.includes('application/pdf');
  const expectedKind = kindFor(name);

  if (isFileUpload && expectedKind !== 'file') {
    return Response.json({ error: holdsTextRefusal(name) }, { status: 400 });
  }
  if (!isFileUpload && expectedKind === 'file') {
    return Response.json({ error: wrongKindRefusal(name) }, { status: 400 });
  }

  if (isFileUpload) {
    const filename = new URL(request.url).searchParams.get('filename') ?? 'resume.pdf';
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > FILE_CAP) {
      return Response.json({ error: overFileCapRefusal(bytes.length) }, { status: 413 });
    }
    if (!beginsLikeAPdf(bytes)) {
      return Response.json({ error: notAPdfRefusal() }, { status: 400 });
    }
    let parsed: Awaited<ReturnType<typeof parseResumePdf>>;
    try {
      parsed = await parseResumePdf(bytes);
    } catch (error) {
      return Response.json({ error: willNotOpenRefusal(String(error)) }, { status: 400 });
    }
    const row = await upsertFileDocument(auth.user.userId, name, bytes, filename);
    return Response.json({
      name: row.name,
      kind: row.kind,
      bytes: row.bytes,
      updated_at: row.updatedAt.toISOString(),
      original_filename: row.originalFilename,
      pages: parsed.pages,
      pages_read: parsed.pagesRead,
      characters: parsed.characters,
      ...(parsed.note ? { note: parsed.note } : {}),
    });
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== 'string') {
    return Response.json({ error: 'the request must include a text field to store' }, { status: 400 });
  }
  const text = body.text;
  const size = Buffer.byteLength(text, 'utf8');
  if (size > PER_DOCUMENT_CAP) {
    return Response.json({ error: perDocumentRefusal(size) }, { status: 413 });
  }
  const otherBytes = await sumOtherTextBytes(auth.user.userId, name);
  const wouldBe = otherBytes + size;
  if (wouldBe > WHOLE_PROFILE_CAP) {
    return Response.json({ error: wholeProfileRefusal(wouldBe) }, { status: 413 });
  }
  await upsertTextDocument(auth.user.userId, name, text);
  return Response.json({ text, stored: true });
}
```

The `GET` function's own imports (`JUDGE_PROMPT_NAME`,
`DEFAULT_JUDGE_PROMPT`, etc. from Task 5) now merge into this same import
block — don't leave two separate `@talenttrove/shared` import lines in the
file; combine them into the one shown above, which already includes
everything `GET` needs too.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run "app/api/profile/[name]/route.test.ts"
```

Expected: PASS (18 tests: 7 from Task 5's `GET` block + 11 here), or
SKIPPED.

- [ ] **Step 5: Commit**

```bash
git add "packages/web/app/api/profile/[name]/route.ts" "packages/web/app/api/profile/[name]/route.test.ts"
git commit -m "web: implement POST /api/profile/[name]"
```

---

### Task 7: `DELETE /api/profile/[name]`

**Files:**
- Modify: `packages/web/app/api/profile/[name]/route.ts` (only the `DELETE` export)
- Modify: `packages/web/app/api/profile/[name]/route.test.ts` (append)

**Interfaces:**
- Consumes: `requireSession`, `deleteProfileDocument` (`lib/profile-db.ts`, Task 3).

- [ ] **Step 1: Write the failing tests**

Append a third `describe.skipIf(!testDatabaseUrl)('DELETE /api/profile/[name]', ...)`
block to `packages/web/app/api/profile/[name]/route.test.ts`, same
`beforeAll`/`afterEach`/`afterAll`/`signedInCookie` boilerplate as the
other two blocks in this file:

```ts
describe.skipIf(!testDatabaseUrl)('DELETE /api/profile/[name]', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let profileDb: typeof import('../../../../lib/profile-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    profileDb = await import('../../../../lib/profile-db.ts');
    route = await import('./route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from profile_documents`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<{ cookie: string; userId: string }> {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return { cookie: sessionCookieHeader(sealed).split(';')[0]!, userId: user.id };
  }

  it('returns 401 when not signed in', async () => {
    const response = await route.DELETE(
      new Request('http://localhost/api/profile/constraints', { method: 'DELETE' }),
      params('constraints'),
    );
    expect(response.status).toBe(401);
  });

  it('deletes a stored document', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'constraints', 'must be remote');

    const response = await route.DELETE(
      new Request('http://localhost/api/profile/constraints', { method: 'DELETE', headers: { cookie } }),
      params('constraints'),
    );
    expect(await response.json()).toEqual({ deleted: true });
    expect(await profileDb.getProfileDocument(userId, 'constraints')).toBeNull();
  });

  it('deleting a document that was never stored is treated as already done', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.DELETE(
      new Request('http://localhost/api/profile/never-stored', { method: 'DELETE', headers: { cookie } }),
      params('never-stored'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
  });

  it('deletes a resume file document', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertFileDocument(userId, 'resume', Buffer.from('%PDF-1.4 fake'), 'r.pdf');

    const response = await route.DELETE(
      new Request('http://localhost/api/profile/resume', { method: 'DELETE', headers: { cookie } }),
      params('resume'),
    );
    expect(await response.json()).toEqual({ deleted: true });
    expect(await profileDb.getProfileDocument(userId, 'resume')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run "app/api/profile/[name]/route.test.ts"
```

Expected: FAIL (or SKIPPED) — `DELETE` still returns the `501` stub.

- [ ] **Step 3: Write the implementation**

Replace only the `DELETE` export in
`packages/web/app/api/profile/[name]/route.ts`. Add `deleteProfileDocument`
to the existing `../../../../lib/profile-db.ts` import line from Task 6
(don't add a second import line for the same module):

```ts
export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  await deleteProfileDocument(auth.user.userId, name);
  return Response.json({ deleted: true });
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run "app/api/profile/[name]/route.test.ts"
```

Expected: PASS (22 tests: 18 from Tasks 5+6 + 4 here), or SKIPPED.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
cd packages/web
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/talenttrove_web_test" npx vitest run
npx tsc --noEmit
```

Expected: everything green (or gated tests SKIPPED without
`TEST_DATABASE_URL`); `tsc --noEmit` clean. This is the checkpoint
confirming `/api/profile` and `/api/profile/[name]` no longer return
`501` for anything, and every other already-existing route/page in the
app (untouched by this plan) still passes.

- [ ] **Step 6: Commit**

```bash
git add "packages/web/app/api/profile/[name]/route.ts" "packages/web/app/api/profile/[name]/route.test.ts"
git commit -m "web: implement DELETE /api/profile/[name]"
```

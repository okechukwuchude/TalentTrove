# Profile storage

Status: approved design, pending spec review
Date: 2026-09-10

## Why

The second of five sub-projects replacing `packages/web`'s dependence on
TalentTrove's hosted server, following
`2026-09-09-auth-database-foundation-design.md`. That sub-project left
`/api/profile` and `/api/profile/[name]` stubbed to `501` ("profile storage
is not built yet") once auth stopped forwarding a TalentTrove access token for
them to proxy with. This sub-project replaces those stubs with real
implementations backed by our own Postgres — storing the resume (a PDF
file) and every text document (`constraints`, `background`, `preferences`,
`judge-prompt`, `quick-judge-prompt`, `application-instructions`, and any
custom user-named text document) a person keeps in their profile.

**Explicitly not in scope for this piece:** tabs, job postings/search, and
judge — each gets its own spec. Judge is expected to read the stored
resume's raw PDF bytes directly (attaching it to a model call) rather than
any extracted text this sub-project computes — this sub-project's PDF text
extraction exists purely to report upload-time feedback ("N pages, M read,
X characters") to the person, and nothing here persists that extracted
text for later reuse.

## Reusing what already exists

Nearly all of the naming rules, size caps, and exact refusal wording this
sub-project needs already exist in `packages/shared/src/registry.ts`,
written for (and — per that file's own comments — pinned by tests in) the
private monorepo's server:

- `RESERVED_NAMES` — the fixed set of names the product gives meaning to
  (`resume` holds a file; `application-instructions`, `constraints`,
  `background`, `preferences`, `judge-prompt`, `quick-judge-prompt` hold
  text) and `reservedKind(name)` to look one up.
- `NAME_RULE` — what a legal custom document name looks like.
- `PER_DOCUMENT_CAP` (64KB), `WHOLE_PROFILE_CAP` (256KB, text documents
  only), `FILE_CAP` (10MB).
- `beginsLikeAPdf(bytes)` — the `%PDF-` header check.
- `DEFAULT_FILE_NAME` (`'resume.pdf'`), `FILE_CONTENT_TYPE`
  (`'application/pdf'`).
- `DEFAULT_JUDGE_PROMPT` / `DEFAULT_QUICK_JUDGE_PROMPT` — the text shown
  when those two names have never been stored.
- The refusal-message builders: `nameRuleRefusal`, `wrongKindRefusal`,
  `holdsTextRefusal`, `overFileCapRefusal`, `notAPdfRefusal`,
  `willNotOpenRefusal`, `perDocumentRefusal`, `wholeProfileRefusal`.

This sub-project's job is almost entirely wiring that existing logic into
real database storage and real route handlers — not inventing new rules
or new wording. Every error message a person sees comes verbatim from one
of the functions above.

## Data model

One table, `profile_documents`, keyed by `(user_id, name)`:

```
profile_documents
  user_id            uuid         not null, references users(id) on delete cascade
  name               text         not null
  kind               text         not null   -- 'text' | 'file'
  text_content       text         null       -- set when kind = 'text'
  file_bytes         bytea        null       -- set when kind = 'file' (the resume PDF)
  bytes              integer      not null   -- byte length, kept alongside content for cheap listing
  original_filename  text         null       -- set when kind = 'file'
  updated_at         timestamptz  not null, default now()
  primary key (user_id, name)
```

`resume` is the only name ever stored with `kind = 'file'`. Every other
reserved name, and every custom user-typed name, is `kind = 'text'` — a
name outside `RESERVED_NAMES` is always legal as a text document and
never anything else (registry.ts: "resume holds an uploaded file; the
other five hold text. A name that is not in the registry is a legal text
document").

`GET /api/profile` (the list) only ever returns rows that actually exist
in this table. An unset `judge-prompt`/`quick-judge-prompt` — which has a
shipped default — never gets a synthesized row; this matches how
`WholeProfileUsage` (`packages/web/app/profile/whole-profile-usage.tsx`)
already only sums *stored* text bytes toward `WHOLE_PROFILE_CAP`.

The extracted resume text is **not** persisted anywhere. It is computed
fresh, once, at upload time, purely to report parse stats back to the
person (see "PDF handling" below); the stored `file_bytes` (the raw PDF)
is what a future judge sub-project is expected to attach to a model call
directly.

## Endpoints

| Route | Behavior |
|---|---|
| `GET /api/profile` | `{rows: [{name, kind, bytes, updated_at, original_filename?}, ...]}` — one row per stored document, in `name` order. |
| `GET /api/profile/[name]` | For a stored text document: `{text, stored: true}`. For an unset name with no shipped default (`constraints`/`background`/`preferences`/`application-instructions`/any custom name): `{text: '', stored: false}`. For an unset `judge-prompt`/`quick-judge-prompt`: `{text: DEFAULT_JUDGE_PROMPT` or `DEFAULT_QUICK_JUDGE_PROMPT, stored: false}`. Calling this on `resume` (file-kind) is out of scope — nothing in the current frontend fetches the resume's content, only its listing metadata, so no download/content endpoint is built here. |
| `POST /api/profile/[name]` | Body `{text: string}`. Validates, stores (upsert), returns `{text, stored: true}`. |
| `POST /api/profile/resume?filename=...` | Body: raw `application/pdf` bytes. Validates, parses, stores (upsert), returns the resulting row plus parse stats: `{name: 'resume', kind: 'file', bytes, updated_at, original_filename, pages?, pages_read?, characters?, note?}`. |
| `DELETE /api/profile/[name]` | Removes the row if present (any name, including `resume`). Always returns `{deleted: true}` — deleting something never stored is treated as already done, matching the exact convention the old (now-stubbed) proxy version of this route already followed. |

### Validation order

1. **Name legality.** A reserved name always passes. A non-reserved name
   must match `NAME_RULE`, or the request is refused with
   `nameRuleRefusal(name)`.
2. **Kind match.** Sending a PDF body to a name whose kind isn't `'file'`
   (i.e., any name except `resume`) is refused with
   `holdsTextRefusal(name)`. Sending a JSON `{text}` body to `resume` is
   refused with `wrongKindRefusal(name)`.
3. **Size caps.**
   - A PDF over `FILE_CAP` → `overFileCapRefusal(size)`.
   - A text document over `PER_DOCUMENT_CAP` on its own →
     `perDocumentRefusal(size)`.
   - Storing this text document would put the account's *other* stored
     text documents' combined bytes plus this one over
     `WHOLE_PROFILE_CAP` → `wholeProfileRefusal(wouldBe)`. Computed as
     "every other stored text document's `bytes`, plus this document's
     new size" — so re-saving the same document at a smaller size never
     falsely trips this.
4. **PDF-specific checks**, in order: the `%PDF-` header
   (`beginsLikeAPdf`; failure → `notAPdfRefusal()`), then an actual parse
   attempt (failure → `willNotOpenRefusal(String(error))`).

### Status codes

- Name/kind/legality problems, not-a-PDF, won't-open: `400`.
- Any size-cap violation (`FILE_CAP`, `PER_DOCUMENT_CAP`,
  `WHOLE_PROFILE_CAP`): `413`.
- Every response body's `error` field is the refusal builder's returned
  string, verbatim — no new wording invented for this sub-project.

## PDF handling

`packages/web/lib/pdf.ts` wraps the `pdf-parse` npm package, exporting:

```ts
export async function parseResumePdf(bytes: Buffer): Promise<{
  pages: number;
  pagesRead: number;
  characters: number;
  note?: string;
}>
```

Kept simple rather than per-page-granular: `pages` is the PDF's total page
count, `characters` is the length of the full extracted text, `pagesRead`
is `pages` when any text came out and `0` when none did, and `note` is set
to `"this file may be a scanned image with no extractable text"` only
when `characters === 0`. This mirrors the product's own framing (per this
repo's existing comments) that the point is catching "a scanned image
with no extractable text," not producing a precise per-page report.

A parse failure (the bytes begin like a PDF but the file is corrupt or
otherwise won't open) throws; the route catches it and responds with
`willNotOpenRefusal(String(error))`.

## File organization

- `packages/web/lib/profile-db.ts` — data access, following the
  `lib/auth-db.ts` naming convention from the auth+database foundation:
  - `listProfileDocuments(userId): Promise<ProfileDocumentRow[]>`
  - `getProfileDocument(userId, name): Promise<ProfileDocumentRow | null>`
  - `upsertTextDocument(userId, name, text): Promise<ProfileDocumentRow>`
  - `upsertFileDocument(userId, name, bytes, originalFilename): Promise<ProfileDocumentRow>`
  - `deleteProfileDocument(userId, name): Promise<void>`
  - `sumOtherTextBytes(userId, excludingName): Promise<number>` — every
    other stored text document's `bytes`, for the whole-profile-cap check
- `packages/web/lib/pdf.ts` — `parseResumePdf`, above.
- `packages/web/app/api/profile/route.ts` and
  `packages/web/app/api/profile/[name]/route.ts` — replace their `501`
  stubs with the real implementations described above.
- A new Drizzle migration adds the `profile_documents` table to the
  schema already established in `packages/web/db/schema.ts`.

## Testing

- **Gated integration tests** (real Postgres, `describe.skipIf(!process.env.TEST_DATABASE_URL)`,
  the pattern this branch already established) for `profile-db.ts` and
  both route files: storing/retrieving/deleting text documents, the
  unset-default behavior for `judge-prompt`/`quick-judge-prompt` versus
  the empty-string behavior for names with no default, every refusal
  path (illegal name, wrong kind both directions, each of the three size
  caps), and the resume upload round-trip.
- **Pure unit tests** for `pdf.ts` using small real PDF fixtures checked
  into the repo (or generated at test time) rather than mocking the
  parser: one PDF with an extractable text layer, one PDF with no
  extractable text (to exercise the `note` field), and one non-PDF file
  (to exercise `beginsLikeAPdf` returning false upstream of ever calling
  `parseResumePdf` at all).

## Out of scope for this design

- Tabs, job postings/search, and judge — each is its own sub-project.
- A download/content endpoint for the resume's raw PDF bytes — nothing in
  the current frontend needs one.
- Persisting extracted resume text for reuse — parsed fresh, once, at
  upload time, purely for the upload-time stats response.
- Any change to the frontend components (`resume-card.tsx`,
  `text-document-card.tsx`, `profile-editor.tsx`,
  `whole-profile-usage.tsx`, `profile-queries.ts`) — they already expect
  exactly the request/response shapes this design produces, since they
  were built against the real (now-stubbed) TalentTrove-backed contract.

import { createRequire } from 'node:module';

// pdf-parse@1.1.1's package entry point (index.js) guards a debug-only code
// path with `!module.parent`. Under a bundler-driven module loader (Vite,
// which vitest uses, and Next's webpack build) `module.parent` is always
// undefined, so that branch runs unconditionally on import: it tries to read
// a fixture PDF from the *package's own* test directory
// (`test/data/05-versions-space.pdf`, which does not exist in this repo) and
// throws ENOENT before `parseResumePdf` is ever called. Importing the inner
// implementation module directly (`pdf-parse/lib/pdf-parse.js`, which is just
// the parse function with no such side effect) sidesteps the bug.
//
// There are no published types for that subpath, and the published
// @types/pdf-parse declaration (which types the package root) requires its
// input as `Buffer` even though the function only ever needs a byte array
// (see the `parseResumePdf` comment below on why we pass a `Uint8Array`, not
// a `Buffer`, at the call site) -- so we declare the minimal shape we
// actually use here instead of importing that type.
type PdfParseFn = (
  data: Uint8Array,
  options?: { version?: string },
) => Promise<{ numpages: number; text: string }>;

const pdfParse = createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js') as PdfParseFn;

export type ParsedResume = {
  pages: number;
  pagesRead: number;
  characters: number;
  text: string;
  note?: string;
};

const NO_TEXT_NOTE = 'this file may be a scanned image with no extractable text';

export async function parseResumePdf(bytes: Buffer): Promise<ParsedResume> {
  // pdf-parse@1.1.1's bundled pdf.js (all vendored versions: v1.9.426,
  // v1.10.88, v1.10.100, v2.0.550) builds its internal byte stream from
  // `data.buffer` directly, without accounting for `data.byteOffset`. Small
  // Node Buffers (Buffer.from(string) among them, well under
  // Buffer.poolSize/2 = 4KiB) are views into a large *shared, pooled*
  // ArrayBuffer, so a Buffer that isn't the first thing allocated in the
  // process typically has a nonzero `byteOffset` into that pool. Handing
  // such a Buffer straight to pdf.js makes it read from byte 0 of the whole
  // pool instead of the offset where our bytes actually start, producing a
  // "bad XRef entry" (or other) parse failure on an otherwise well-formed
  // PDF -- the file's own bytes are never wrong, it's reading the wrong
  // bytes entirely. This was invisible in a quick one-off script (the very
  // first small Buffer allocated in a process happens to land at offset 0)
  // but reproduced reliably once other Buffers had already been allocated
  // first, which is the normal case in a real server process and under the
  // test runner here. `new Uint8Array(bytes)` is the TypedArray copy
  // constructor: it copies exactly `bytes.byteLength` bytes starting at
  // `bytes.byteOffset` into a fresh, unshared ArrayBuffer with its own
  // byteOffset of 0, which sidesteps the bug regardless of where the
  // caller's Buffer happened to land in memory.
  const data = await pdfParse(new Uint8Array(bytes));
  // pdf-parse@1.1.1 joins pages with a literal "\n\n" separator -- including
  // before the *first* page -- so `data.text` is never actually empty for a
  // textless page; it's "\n\n" (or "\n\n" repeated per blank page). Trimming
  // before measuring is what makes `characters === 0` (and therefore the
  // "no extractable text" note below) reflect real extracted content rather
  // than an artifact of how the library concatenates pages.
  const characters = data.text.trim().length;
  const pages = data.numpages;
  const pagesRead = characters > 0 ? pages : 0;
  return {
    pages,
    pagesRead,
    characters,
    text: data.text.trim(),
    ...(characters === 0 ? { note: NO_TEXT_NOTE } : {}),
  };
}

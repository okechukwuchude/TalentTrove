import { describe, expect, it } from 'vitest';
import { parseResumePdf } from './pdf.ts';

// A minimal, hand-built, valid single-page PDF with one line of real text
// ("Hello resume") drawn via a content stream — small enough to inline,
// and exercises a genuine text-extraction path rather than a mock.
// NOTE: the xref byte offsets below are exact (computed from the byte
// length of everything preceding each "N 0 obj", not copy-pasted zeros) —
// see the comment above `parseResumePdf`'s test describe block for why.
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
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
0000000211 00000 n
0000000272 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
362
%%EOF`,
  'latin1',
);

// Same shape, but an empty content stream — a valid, openable PDF with no
// extractable text at all (the "scanned image" case).
// NOTE: like PDF_WITH_TEXT above, the xref offsets here are exact.
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
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
0000000193 00000 n
trailer<</Size 5/Root 1 0 R>>
startxref
238
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

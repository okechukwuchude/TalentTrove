import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// A minimal, valid, single-page PDF with one line of real text — same
// fixture shape as lib/pdf.test.ts's PDF_WITH_TEXT, reused here so the
// tailoring pipeline's own resume-parsing step has something real to parse.
const RESUME_PDF = Buffer.from(
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

const STYLE_PROFILE = {
  sectionOrder: ['summary', 'experience'],
  contact: { name: 'Jane Doe', email: 'jane@example.com' },
};

const TAILORED_CONTENT = {
  summary: 'Tailored summary.',
  skills: [],
  experience: [{ title: 'Engineer', company: 'Acme', dates: '2022-Present', bullets: ['Did things.'] }],
  education: [],
};

describe.skipIf(!testDatabaseUrl)('runTailoring', () => {
  let authDb: typeof import('../auth-db.ts');
  let profileDb: typeof import('../profile-db.ts');
  let runTailoring: typeof import('./run-tailoring.ts')['runTailoring'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../auth-db.ts');
    profileDb = await import('../profile-db.ts');
    ({ runTailoring } = await import('./run-tailoring.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.JUDGE_MODEL = 'test/model';
  });

  afterEach(async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.JUDGE_MODEL;
    delete process.env.TAILOR_BATCH_SIZE;
    await sql`delete from tailored_resumes`;
    await sql`delete from judgments`;
    await sql`delete from postings`;
    await sql`delete from profile_documents`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function freshUserId(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    return user.id;
  }

  async function insertPosting(title = 'Staff Engineer'): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source)
      values (${title}, 'Acme', ${`https://example.com/jobs/${crypto.randomUUID()}`}, 'seed')
      returning id
    `;
    return row!.id;
  }

  async function insertJudgment(userId: string, postingId: string, verdict: string): Promise<void> {
    await sql`
      insert into judgments (user_id, posting_id, verdict, reasoning, model)
      values (${userId}, ${postingId}, ${verdict}, 'x', 'test/model')
    `;
  }

  const alwaysStyle = async () => STYLE_PROFILE;
  const alwaysTailor = async () => TAILORED_CONTENT;

  it('skips an account with no resume, without calling either model', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();
    await insertJudgment(userId, postingId, 'strong');
    let styleCalls = 0;
    let tailorCalls = 0;

    const summary = await runTailoring(
      async () => {
        styleCalls += 1;
        return STYLE_PROFILE;
      },
      async () => {
        tailorCalls += 1;
        return TAILORED_CONTENT;
      },
    );

    expect(styleCalls).toBe(0);
    expect(tailorCalls).toBe(0);
    expect(summary.find((row) => row.userId === userId)).toBeUndefined();
  });

  it('skips an account with a resume but no strong/fair, untailored candidates, without calling extractStyleProfile', async () => {
    const userId = await freshUserId();
    await profileDb.upsertFileDocument(userId, 'resume', RESUME_PDF, 'resume.pdf');
    let styleCalls = 0;

    const summary = await runTailoring(async () => {
      styleCalls += 1;
      return STYLE_PROFILE;
    }, alwaysTailor);

    expect(styleCalls).toBe(0);
    expect(summary.find((row) => row.userId === userId)).toBeUndefined();
  });

  it('computes the style profile once and reuses it across multiple candidates and across runs', async () => {
    const userId = await freshUserId();
    await profileDb.upsertFileDocument(userId, 'resume', RESUME_PDF, 'resume.pdf');
    const postingA = await insertPosting('A');
    const postingB = await insertPosting('B');
    await insertJudgment(userId, postingA, 'strong');
    await insertJudgment(userId, postingB, 'fair');
    let styleCalls = 0;
    const countingStyle = async () => {
      styleCalls += 1;
      return STYLE_PROFILE;
    };

    const firstRun = await runTailoring(countingStyle, alwaysTailor);
    expect(styleCalls).toBe(1);
    expect(firstRun).toEqual([{ userId, tailored: 2, failed: 0 }]);

    const postingC = await insertPosting('C');
    await insertJudgment(userId, postingC, 'strong');
    const secondRun = await runTailoring(countingStyle, alwaysTailor);
    expect(styleCalls).toBe(1);
    expect(secondRun).toEqual([{ userId, tailored: 1, failed: 0 }]);
  });

  it('does not retailor a posting that already has a tailored resume for this user', async () => {
    const userId = await freshUserId();
    await profileDb.upsertFileDocument(userId, 'resume', RESUME_PDF, 'resume.pdf');
    const postingId = await insertPosting();
    await insertJudgment(userId, postingId, 'strong');
    await sql`
      insert into tailored_resumes (user_id, posting_id, pdf_bytes, model)
      values (${userId}, ${postingId}, ${Buffer.from('%PDF-existing')}, 'test/model')
    `;
    let tailorCalls = 0;

    const summary = await runTailoring(alwaysStyle, async () => {
      tailorCalls += 1;
      return TAILORED_CONTENT;
    });

    expect(tailorCalls).toBe(0);
    expect(summary.find((row) => row.userId === userId)).toBeUndefined();
  });

  it('keeps tailoring the rest of the batch when one posting fails', async () => {
    const userId = await freshUserId();
    await profileDb.upsertFileDocument(userId, 'resume', RESUME_PDF, 'resume.pdf');
    const postingA = await insertPosting('Will fail');
    const postingB = await insertPosting('Will succeed');
    await insertJudgment(userId, postingA, 'strong');
    await insertJudgment(userId, postingB, 'strong');
    let calls = 0;

    const summary = await runTailoring(alwaysStyle, async () => {
      calls += 1;
      return calls === 1 ? { error: 'boom' } : TAILORED_CONTENT;
    });

    expect(calls).toBe(2);
    expect(summary).toEqual([{ userId, tailored: 1, failed: 1 }]);
    const rows = await sql`select * from tailored_resumes where user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });

  it('tailors at most TAILOR_BATCH_SIZE postings in one run', async () => {
    const userId = await freshUserId();
    await profileDb.upsertFileDocument(userId, 'resume', RESUME_PDF, 'resume.pdf');
    for (const title of ['A', 'B', 'C']) {
      const postingId = await insertPosting(title);
      await insertJudgment(userId, postingId, 'strong');
    }
    process.env.TAILOR_BATCH_SIZE = '2';

    const summary = await runTailoring(alwaysStyle, alwaysTailor);

    expect(summary).toEqual([{ userId, tailored: 2, failed: 0 }]);
    const rows = await sql`select * from tailored_resumes where user_id = ${userId}`;
    expect(rows).toHaveLength(2);
  });
});

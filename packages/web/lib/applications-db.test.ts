import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('applications-db', () => {
  let authDb: typeof import('./auth-db.ts');
  let applicationsDb: typeof import('./applications-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    applicationsDb = await import('./applications-db.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from applications`;
    await sql`delete from tailored_resumes`;
    await sql`delete from judgments`;
    await sql`delete from postings`;
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

  async function insertTailoredResume(userId: string, postingId: string, coverLetter = 'Dear Hiring Manager,'): Promise<void> {
    await sql`
      insert into tailored_resumes (user_id, posting_id, pdf_bytes, cover_letter, model)
      values (${userId}, ${postingId}, ${Buffer.from('%PDF-fake')}, ${coverLetter}, 'test/model')
    `;
  }

  it('includes a strong-verdict, tailored, unapplied posting with its cover letter', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();
    await insertJudgment(userId, postingId, 'strong');
    await insertTailoredResume(userId, postingId, 'Dear Hiring Manager, I am excited...');

    const result = await applicationsDb.getApplicationQueue(userId, 20, null);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.cover_letter).toBe('Dear Hiring Manager, I am excited...');
    expect(result.rows[0]!.verdict).toBe('strong');
  });

  it('excludes a weak-verdict posting even if tailored', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();
    await insertJudgment(userId, postingId, 'weak');
    await insertTailoredResume(userId, postingId);

    const result = await applicationsDb.getApplicationQueue(userId, 20, null);

    expect(result.rows).toHaveLength(0);
  });

  it('excludes an already-applied posting', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();
    await insertJudgment(userId, postingId, 'strong');
    await insertTailoredResume(userId, postingId);
    await applicationsDb.markApplied(userId, postingId);

    const result = await applicationsDb.getApplicationQueue(userId, 20, null);

    expect(result.rows).toHaveLength(0);
  });

  it('excludes a tailored posting with no matching judgment row', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();
    await insertTailoredResume(userId, postingId);

    const result = await applicationsDb.getApplicationQueue(userId, 20, null);

    expect(result.rows).toHaveLength(0);
  });

  it('markApplied is idempotent', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();

    await applicationsDb.markApplied(userId, postingId);
    await applicationsDb.markApplied(userId, postingId);

    const rows = await sql`select * from applications where user_id = ${userId} and posting_id = ${postingId}`;
    expect(rows).toHaveLength(1);
  });

  it('unmarkApplied removes a row and is a no-op if none exists', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();
    await applicationsDb.markApplied(userId, postingId);

    await applicationsDb.unmarkApplied(userId, postingId);
    await applicationsDb.unmarkApplied(userId, postingId);

    const rows = await sql`select * from applications where user_id = ${userId} and posting_id = ${postingId}`;
    expect(rows).toHaveLength(0);
  });

  it('paginates with a cursor', async () => {
    const userId = await freshUserId();
    for (const title of ['A', 'B', 'C']) {
      const postingId = await insertPosting(title);
      await insertJudgment(userId, postingId, 'strong');
      await insertTailoredResume(userId, postingId);
    }

    const firstPage = await applicationsDb.getApplicationQueue(userId, 2, null);
    expect(firstPage.rows).toHaveLength(2);
    expect(firstPage.cursor).toBeTruthy();

    const secondPage = await applicationsDb.getApplicationQueue(userId, 2, firstPage.cursor);
    expect(secondPage.rows).toHaveLength(1);
    expect(secondPage.cursor).toBeNull();

    const seenTitles = [...firstPage.rows, ...secondPage.rows].map((row) => row.title).sort();
    expect(seenTitles).toEqual(['A', 'B', 'C']);
  });
});

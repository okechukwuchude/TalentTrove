import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('runJudging', () => {
  let authDb: typeof import('../auth-db.ts');
  let profileDb: typeof import('../profile-db.ts');
  let runJudging: typeof import('./run-judging.ts')['runJudging'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../auth-db.ts');
    profileDb = await import('../profile-db.ts');
    ({ runJudging } = await import('./run-judging.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.JUDGE_MODEL = 'test/model';
  });

  afterEach(async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.JUDGE_MODEL;
    delete process.env.JUDGE_BATCH_SIZE;
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

  async function insertPosting(overrides: Partial<{ title: string }> = {}): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source)
      values (${overrides.title ?? 'Staff Engineer'}, 'Acme', ${`https://example.com/jobs/${crypto.randomUUID()}`}, 'seed')
      returning id
    `;
    return row!.id;
  }

  it('skips a user with no profile substance, without calling the model', async () => {
    const userId = await freshUserId();
    await insertPosting();
    let called = false;

    const summary = await runJudging(async () => {
      called = true;
      return { verdict: 'strong', reasoning: 'x' };
    });

    expect(called).toBe(false);
    expect(summary.find((row) => row.userId === userId)).toBeUndefined();
    const rows = await sql`select * from judgments`;
    expect(rows).toHaveLength(0);
  });

  it('does not re-judge a posting that already has a judgment for this user', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    const postingId = await insertPosting();
    await sql`
      insert into judgments (user_id, posting_id, verdict, reasoning, model)
      values (${userId}, ${postingId}, 'fair', 'already judged', 'test/model')
    `;
    let calls = 0;

    const summary = await runJudging(async () => {
      calls += 1;
      return { verdict: 'strong', reasoning: 'x' };
    });

    expect(calls).toBe(0);
    expect(summary.find((row) => row.userId === userId)).toBeUndefined();
  });

  it('keeps judging the rest of the batch when one posting fails', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting({ title: 'Will fail' });
    await insertPosting({ title: 'Will succeed' });
    let calls = 0;

    const summary = await runJudging(async () => {
      calls += 1;
      return calls === 1 ? { error: 'boom' } : { verdict: 'fair', reasoning: 'ok' };
    });

    expect(calls).toBe(2);
    expect(summary).toEqual([{ userId, judged: 1, failed: 1 }]);
    const rows = await sql`select * from judgments where user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });

  it('keeps judging the rest of the batch when one posting throws instead of returning an error result', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting({ title: 'Will throw' });
    await insertPosting({ title: 'Will succeed' });
    let calls = 0;

    const summary = await runJudging(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { verdict: 'fair', reasoning: 'ok' };
    });

    expect(calls).toBe(2);
    expect(summary).toEqual([{ userId, judged: 1, failed: 1 }]);
    const rows = await sql`select * from judgments where user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });

  it('excludes the quick-judge-prompt document from the profile text sent to the model', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await profileDb.upsertTextDocument(userId, 'quick-judge-prompt', 'BATCH SCREENING INSTRUCTIONS: score 100 postings at once.');
    await insertPosting();
    let capturedProfileText: string | undefined;

    await runJudging(async (_apiKey, request) => {
      capturedProfileText = request.profileText;
      return { verdict: 'fair', reasoning: 'ok' };
    });

    expect(capturedProfileText).not.toContain('BATCH SCREENING INSTRUCTIONS');
  });

  it('includes stored background text and excludes the judge-prompt document from the profile text sent to the model', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer with 10 years of experience.');
    await profileDb.upsertTextDocument(userId, 'judge-prompt', 'CUSTOM JUDGE INSTRUCTIONS.');
    await insertPosting();
    let capturedProfileText: string | undefined;

    await runJudging(async (_apiKey, request) => {
      capturedProfileText = request.profileText;
      return { verdict: 'fair', reasoning: 'ok' };
    });

    expect(capturedProfileText).toContain('Backend engineer with 10 years of experience.');
    expect(capturedProfileText).not.toContain('CUSTOM JUDGE INSTRUCTIONS');
  });

  it('judges at most JUDGE_BATCH_SIZE postings in one run', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting();
    await insertPosting();
    await insertPosting();
    process.env.JUDGE_BATCH_SIZE = '2';

    const summary = await runJudging(async () => ({ verdict: 'fair', reasoning: 'ok' }));

    expect(summary).toEqual([{ userId, judged: 2, failed: 0 }]);
    const rows = await sql`select * from judgments where user_id = ${userId}`;
    expect(rows).toHaveLength(2);
  });
});

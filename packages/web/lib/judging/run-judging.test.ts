import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('runJudging', () => {
  let authDb: typeof import('../auth-db.ts');
  let profileDb: typeof import('../profile-db.ts');
  let routinesDb: typeof import('../routines-db.ts');
  let runJudging: typeof import('./run-judging.ts')['runJudging'];
  let TIME_BUDGET_MS: typeof import('./run-judging.ts')['TIME_BUDGET_MS'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../auth-db.ts');
    profileDb = await import('../profile-db.ts');
    routinesDb = await import('../routines-db.ts');
    ({ runJudging, TIME_BUDGET_MS } = await import('./run-judging.ts'));
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
    await sql`delete from routines`;
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

  it('skips a user whose only profile-substance document is empty/whitespace-only, without calling the model', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', '   ');
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

  it('judges only postings matching a routine filter, using that routine prompt, when the account has one routine', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting({ title: 'Backend Engineer' });
    await insertPosting({ title: 'Data Scientist' });
    await routinesDb.createRoutine(userId, 'backend-only', { q: 'Backend Engineer' }, 'BACKEND PROMPT', null);
    const capturedPrompts: string[] = [];

    const summary = await runJudging(async (_apiKey, request) => {
      capturedPrompts.push(request.systemPrompt);
      return { verdict: 'fair', reasoning: 'ok' };
    });

    expect(summary).toEqual([{ userId, judged: 1, failed: 0 }]);
    expect(capturedPrompts).toEqual(['BACKEND PROMPT']);
  });

  it('falls back to DEFAULT_JUDGE_PROMPT, not the account judge-prompt document, when a routine has no judgePrompt', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await profileDb.upsertTextDocument(userId, 'judge-prompt', 'ACCOUNT LEVEL OVERRIDE');
    await insertPosting();
    await routinesDb.createRoutine(userId, 'no-prompt', {}, null, null);
    let capturedPrompt: string | undefined;

    await runJudging(async (_apiKey, request) => {
      capturedPrompt = request.systemPrompt;
      return { verdict: 'fair', reasoning: 'ok' };
    });

    expect(capturedPrompt).not.toContain('ACCOUNT LEVEL OVERRIDE');
  });

  it('caps each routine at JUDGE_BATCH_SIZE independently', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting();
    await insertPosting();
    await insertPosting();
    await routinesDb.createRoutine(userId, 'r1', {}, null, null);
    await routinesDb.createRoutine(userId, 'r2', {}, null, null);
    process.env.JUDGE_BATCH_SIZE = '2';

    const summary = await runJudging(async () => ({ verdict: 'fair', reasoning: 'ok' }));

    // r1 judges 2 (its own cap), leaving 1 unjudged posting for r2 to pick up (also capped at 2, but only 1 remains).
    expect(summary).toEqual([{ userId, judged: 3, failed: 0 }]);
  });

  it('judges a posting matching two routines exactly once, by the first routine in creation order', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting({ title: 'Staff Engineer' });
    await routinesDb.createRoutine(userId, 'first', {}, 'FIRST PROMPT', null);
    await routinesDb.createRoutine(userId, 'second', {}, 'SECOND PROMPT', null);
    const capturedPrompts: string[] = [];

    const summary = await runJudging(async (_apiKey, request) => {
      capturedPrompts.push(request.systemPrompt);
      return { verdict: 'fair', reasoning: 'ok' };
    });

    expect(summary).toEqual([{ userId, judged: 1, failed: 0 }]);
    expect(capturedPrompts).toEqual(['FIRST PROMPT']);
  });

  it('files a strong verdict into destinationTab, creating the tab if it does not exist', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting();
    await routinesDb.createRoutine(userId, 'filed', {}, null, 'Backend Roles');

    await runJudging(async () => ({ verdict: 'strong', reasoning: 'ok' }));

    const tabRows = await sql`select id from tabs where user_id = ${userId} and name = 'Backend Roles'`;
    expect(tabRows).toHaveLength(1);
    const itemRows = await sql`select posting_id from tab_items where tab_id = ${tabRows[0]!.id}`;
    expect(itemRows).toHaveLength(1);
  });

  it('does not file a weak verdict into destinationTab', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting();
    await routinesDb.createRoutine(userId, 'filed', {}, null, 'Backend Roles');

    await runJudging(async () => ({ verdict: 'weak', reasoning: 'ok' }));

    const tabRows = await sql`select id from tabs where user_id = ${userId} and name = 'Backend Roles'`;
    expect(tabRows).toHaveLength(0);
  });

  it('judges normally without filing when a routine has no destinationTab', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting();
    await routinesDb.createRoutine(userId, 'unfiled', {}, null, null);

    const summary = await runJudging(async () => ({ verdict: 'strong', reasoning: 'ok' }));

    expect(summary).toEqual([{ userId, judged: 1, failed: 0 }]);
    const tabRows = await sql`select id from tabs where user_id = ${userId}`;
    expect(tabRows).toHaveLength(0);
  });

  it('does not stop other routines or other accounts when one routine throws', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    const otherUserId = await freshUserId();
    await profileDb.upsertTextDocument(otherUserId, 'background', 'Data scientist.');
    await insertPosting({ title: 'Broken Filter Target' });
    await insertPosting({ title: 'Good Routine Target' });
    await insertPosting({ title: 'Other Account Target' });
    // A stored filter shape that makes buildSearchConditions itself throw at
    // the JS level: its very first statement is
    // `Boolean(filters.q && filters.q.trim())` (postings-search.ts), which
    // calls `.trim()` unconditionally once `filters.q` is truthy. A non-string
    // `q` (a number, here) is truthy but has no `.trim` method, so this throws
    // a TypeError synchronously, before any DB query runs — verified by
    // reading buildSearchConditions's source rather than assumed.
    await sql`insert into routines (user_id, name, filters) values (${userId}, 'broken', ${sql.json({ q: 123 })})`;
    await routinesDb.createRoutine(userId, 'good', {}, null, null);
    await routinesDb.createRoutine(otherUserId, 'other', {}, null, null);

    const summary = await runJudging(async () => ({ verdict: 'fair', reasoning: 'ok' }));

    // The broken routine's per-routine try/catch must record its own throw as
    // a failure, without preventing the account's other routine ('good') from
    // judging normally.
    const brokenUserSummary = summary.find((row) => row.userId === userId);
    expect(brokenUserSummary?.failed).toBeGreaterThan(0);
    expect(brokenUserSummary?.judged).toBeGreaterThan(0);
    // The other account's routine must be unaffected entirely.
    const otherSummary = summary.find((row) => row.userId === otherUserId);
    expect(otherSummary?.judged).toBeGreaterThan(0);
  });

  it('judges a routine account and a zero-routines account correctly in the same run', async () => {
    // A single shared posting, judged independently by each account through
    // its own code path: the routine-scoped account matches it via its
    // filter (routine branch), and the zero-routines account picks it up
    // via the ordinary global sweep (non-routine branch) since it has no
    // judgment of its own for this posting yet. Two separate judgments rows
    // result (judgments are keyed per user, not globally), proving neither
    // branch's behavior leaks into or is disrupted by the other's in the
    // same runJudging() call.
    await insertPosting({ title: 'Backend Engineer' });

    const routineUserId = await freshUserId();
    await profileDb.upsertTextDocument(routineUserId, 'background', 'Backend engineer.');
    await routinesDb.createRoutine(routineUserId, 'backend-only', { q: 'Backend Engineer' }, null, null);

    const globalUserId = await freshUserId();
    await profileDb.upsertTextDocument(globalUserId, 'background', 'Anything works.');

    const summary = await runJudging(async () => ({ verdict: 'fair', reasoning: 'ok' }));

    const routineSummary = summary.find((row) => row.userId === routineUserId);
    const globalSummary = summary.find((row) => row.userId === globalUserId);
    expect(routineSummary).toEqual({ userId: routineUserId, judged: 1, failed: 0 });
    expect(globalSummary).toEqual({ userId: globalUserId, judged: 1, failed: 0 });
  });

  it('stops judging once the time budget is exhausted, leaving the rest of the batch for the next run', async () => {
    const userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'Backend engineer.');
    await insertPosting({ title: 'A' });
    await insertPosting({ title: 'B' });

    // Simulate a single judge call taking longer than the whole budget, so
    // the clock crosses the deadline the moment the first call returns.
    let clock = 0;
    const slowJudge = async () => {
      clock += TIME_BUDGET_MS + 10_000;
      return { verdict: 'fair' as const, reasoning: 'ok' };
    };

    const summary = await runJudging(slowJudge, () => clock);

    expect(summary).toEqual([{ userId, judged: 1, failed: 0 }]);
    const rows = await sql`select * from judgments where user_id = ${userId}`;
    expect(rows).toHaveLength(1);

    // Next scheduled run, with a real clock, picks up where this one left off.
    const secondRun = await runJudging(async () => ({ verdict: 'fair', reasoning: 'ok' }));
    expect(secondRun).toEqual([{ userId, judged: 1, failed: 0 }]);
  });

  it('stops starting new accounts once the time budget is exhausted, leaving them for the next run', async () => {
    const firstUserId = await freshUserId();
    const secondUserId = await freshUserId();
    await profileDb.upsertTextDocument(firstUserId, 'background', 'Backend engineer.');
    await profileDb.upsertTextDocument(secondUserId, 'background', 'Data scientist.');
    // A single posting, unjudged by either account: postings aren't scoped to
    // an account, so this is enough for each account to have exactly one
    // candidate, keeping the second run's expectation unambiguous regardless
    // of which account the budget guard defers.
    await insertPosting();

    let clock = 0;
    const slowJudge = async () => {
      clock += TIME_BUDGET_MS + 10_000;
      return { verdict: 'fair' as const, reasoning: 'ok' };
    };

    // Account processing order isn't specified, so only assert the invariant
    // the budget guard exists to enforce: one account gets processed this
    // run and the other is deferred to the next one.
    const summary = await runJudging(slowJudge, () => clock);

    expect(summary).toHaveLength(1);
    expect(summary[0]!.judged).toBe(1);
    const deferredUserId = summary[0]!.userId === firstUserId ? secondUserId : firstUserId;

    const secondRun = await runJudging(async () => ({ verdict: 'fair', reasoning: 'ok' }));
    expect(secondRun).toEqual([{ userId: deferredUserId, judged: 1, failed: 0 }]);
  });
});

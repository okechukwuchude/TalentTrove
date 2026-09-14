import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('POST /api/search', () => {
  let authDb: typeof import('../../../lib/auth-db.ts');
  let POST: typeof import('./route.ts')['POST'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../lib/auth-db.ts');
    ({ POST } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from judgments`;
    await sql`delete from postings`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInUser(): Promise<{ userId: string; cookie: string }> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return { userId: user.id, cookie: sessionCookieHeader(sealed).split(';')[0]! };
  }

  it('returns 401 when not signed in', async () => {
    const response = await POST(new Request('http://localhost/api/search', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('returns all postings, newest first, with no body', async () => {
    const { cookie } = await signedInUser();
    await sql`insert into postings (title, company, url, source, posted_at) values ('Staff Engineer', 'Acme', 'https://example.com/jobs/search-1', 'seed', '2026-09-01T00:00:00Z')`;

    const response = await POST(new Request('http://localhost/api/search', { method: 'POST', headers: { cookie } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].title).toBe('Staff Engineer');
    expect(body).not.toHaveProperty('interpretation');
  });

  it('filters by q', async () => {
    const { cookie } = await signedInUser();
    await sql`insert into postings (title, company, url, source) values ('Staff Backend Engineer', 'Acme', 'https://example.com/jobs/search-2', 'seed')`;
    await sql`insert into postings (title, company, url, source) values ('Marketing Manager', 'Acme', 'https://example.com/jobs/search-3', 'seed')`;

    const response = await POST(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'backend engineer' }),
      }),
    );
    const body = await response.json();

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].title).toBe('Staff Backend Engineer');
  });

  it('unjudged: true excludes a posting the caller already judged', async () => {
    const { userId, cookie } = await signedInUser();
    await sql`insert into postings (title, company, url, source) values ('Judged', 'Acme', 'https://example.com/jobs/search-5', 'seed')`;
    await sql`insert into postings (title, company, url, source) values ('Unjudged', 'Acme', 'https://example.com/jobs/search-6', 'seed')`;
    const judgedId = (await sql<{ id: string }[]>`select id from postings where title = 'Judged'`)[0]!.id;
    await sql`
      insert into judgments (user_id, posting_id, verdict, reasoning, model)
      values (${userId}, ${judgedId}, 'strong', 'Great fit.', 'test/model')
    `;

    const response = await POST(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unjudged: true }),
      }),
    );
    const body = await response.json();

    expect(body.rows.map((row: { title: string }) => row.title)).toEqual(['Unjudged']);
  });

  it('treats a malformed JSON body as no filters rather than a 400', async () => {
    const { cookie } = await signedInUser();
    await sql`insert into postings (title, company, url, source) values ('Staff Engineer', 'Acme', 'https://example.com/jobs/search-4', 'seed')`;

    const response = await POST(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(1);
  });
});

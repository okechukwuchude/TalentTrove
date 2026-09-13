import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('GET /api/companies', () => {
  let authDb: typeof import('../../../lib/auth-db.ts');
  let GET: typeof import('./route.ts')['GET'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../lib/auth-db.ts');
    ({ GET } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from postings`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<string> {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return sessionCookieHeader(sealed).split(';')[0]!;
  }

  it('returns 401 when not signed in', async () => {
    const response = await GET(new Request('http://localhost/api/companies'));
    expect(response.status).toBe(401);
  });

  it('returns matching companies with posting counts', async () => {
    const cookie = await signedInCookie();
    await sql`insert into postings (title, company, url, source) values ('A', 'Acme Corp', 'https://example.com/jobs/companies-1', 'seed')`;
    await sql`insert into postings (title, company, url, source) values ('B', 'Acme Corp', 'https://example.com/jobs/companies-2', 'seed')`;
    await sql`insert into postings (title, company, url, source) values ('C', 'Globex', 'https://example.com/jobs/companies-3', 'seed')`;

    const response = await GET(new Request('http://localhost/api/companies?q=acme', { headers: { cookie } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toEqual([{ id: 'Acme Corp', name: 'Acme Corp', posting_count: 2 }]);
  });

  it('returns an empty list for a query under 2 characters', async () => {
    const cookie = await signedInCookie();
    const response = await GET(new Request('http://localhost/api/companies?q=a', { headers: { cookie } }));
    expect(await response.json()).toEqual({ rows: [] });
  });
});

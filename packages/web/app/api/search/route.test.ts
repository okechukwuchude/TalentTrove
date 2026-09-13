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
    await sql`delete from postings`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return sessionCookieHeader(sealed).split(';')[0]!;
  }

  it('returns 401 when not signed in', async () => {
    const response = await POST(new Request('http://localhost/api/search', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('returns all postings, newest first, with no body', async () => {
    const cookie = await signedInCookie();
    await sql`insert into postings (title, company, url, source, posted_at) values ('Staff Engineer', 'Acme', 'https://example.com/jobs/search-1', 'seed', '2026-09-01T00:00:00Z')`;

    const response = await POST(new Request('http://localhost/api/search', { method: 'POST', headers: { cookie } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].title).toBe('Staff Engineer');
    expect(body).not.toHaveProperty('interpretation');
  });

  it('filters by q, ignoring an unjudged flag it does not yet act on', async () => {
    const cookie = await signedInCookie();
    await sql`insert into postings (title, company, url, source) values ('Staff Backend Engineer', 'Acme', 'https://example.com/jobs/search-2', 'seed')`;
    await sql`insert into postings (title, company, url, source) values ('Marketing Manager', 'Acme', 'https://example.com/jobs/search-3', 'seed')`;

    const response = await POST(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'backend engineer', unjudged: true }),
      }),
    );
    const body = await response.json();

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].title).toBe('Staff Backend Engineer');
  });

  it('treats a malformed JSON body as no filters rather than a 400', async () => {
    const cookie = await signedInCookie();
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

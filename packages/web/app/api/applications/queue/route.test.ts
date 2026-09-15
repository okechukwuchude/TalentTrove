import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('GET /api/applications/queue', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    route = await import('./route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from applications`;
    await sql`delete from tailored_resumes`;
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
    const response = await route.GET(new Request('http://localhost/api/applications/queue'));
    expect(response.status).toBe(401);
  });

  it('returns rows and cursor', async () => {
    const { userId, cookie } = await signedInUser();
    const [posting] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source) values ('Staff Engineer', 'Acme', 'https://x/p1', 'seed') returning id
    `;
    await sql`insert into judgments (user_id, posting_id, verdict, reasoning, model) values (${userId}, ${posting!.id}, 'strong', 'x', 'test/model')`;
    await sql`insert into tailored_resumes (user_id, posting_id, pdf_bytes, cover_letter, model) values (${userId}, ${posting!.id}, ${Buffer.from('%PDF')}, 'Dear Hiring Manager,', 'test/model')`;

    const response = await route.GET(new Request('http://localhost/api/applications/queue?limit=20', { headers: { cookie } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].cover_letter).toBe('Dear Hiring Manager,');
    expect(body.cursor).toBeNull();
  });

  it('excludes an applied posting through the route', async () => {
    const { userId, cookie } = await signedInUser();
    const [posting] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source) values ('Staff Engineer', 'Acme', 'https://x/p1', 'seed') returning id
    `;
    await sql`insert into judgments (user_id, posting_id, verdict, reasoning, model) values (${userId}, ${posting!.id}, 'strong', 'x', 'test/model')`;
    await sql`insert into tailored_resumes (user_id, posting_id, pdf_bytes, cover_letter, model) values (${userId}, ${posting!.id}, ${Buffer.from('%PDF')}, 'letter', 'test/model')`;
    await sql`insert into applications (user_id, posting_id) values (${userId}, ${posting!.id})`;

    const response = await route.GET(new Request('http://localhost/api/applications/queue', { headers: { cookie } }));
    const body = await response.json();

    expect(body.rows).toHaveLength(0);
  });
});

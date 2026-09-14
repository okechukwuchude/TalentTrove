import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/tailored-resumes/[postingId]', () => {
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
    await sql`delete from tailored_resumes`;
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

  async function insertPosting(): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source) values ('Staff Engineer', 'Acme', 'https://x/p1', 'seed') returning id
    `;
    return row!.id;
  }

  it('returns 401 when not signed in', async () => {
    const postingId = await insertPosting();
    const response = await route.GET(new Request(`http://localhost/api/tailored-resumes/${postingId}`), {
      params: Promise.resolve({ postingId }),
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 (not 500) when postingId is not a valid uuid', async () => {
    const { cookie } = await signedInUser();
    const response = await route.GET(
      new Request('http://localhost/api/tailored-resumes/not-a-uuid', { headers: { cookie } }),
      { params: Promise.resolve({ postingId: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 when no tailored resume exists for this posting', async () => {
    const { cookie } = await signedInUser();
    const postingId = await insertPosting();
    const response = await route.GET(
      new Request(`http://localhost/api/tailored-resumes/${postingId}`, { headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 when the tailored resume belongs to a different user', async () => {
    const { cookie } = await signedInUser();
    const otherUser = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    const postingId = await insertPosting();
    await sql`
      insert into tailored_resumes (user_id, posting_id, pdf_bytes, model)
      values (${otherUser.id}, ${postingId}, ${Buffer.from('%PDF-fake')}, 'test/model')
    `;

    const response = await route.GET(
      new Request(`http://localhost/api/tailored-resumes/${postingId}`, { headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );
    expect(response.status).toBe(404);
  });

  it('returns the stored PDF with the correct content type', async () => {
    const { userId, cookie } = await signedInUser();
    const postingId = await insertPosting();
    await sql`
      insert into tailored_resumes (user_id, posting_id, pdf_bytes, model)
      values (${userId}, ${postingId}, ${Buffer.from('%PDF-fake')}, 'test/model')
    `;

    const response = await route.GET(
      new Request(`http://localhost/api/tailored-resumes/${postingId}`, { headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString()).toBe('%PDF-fake');
  });
});

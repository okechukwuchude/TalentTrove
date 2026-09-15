import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/applications/[postingId]', () => {
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

  it('POST returns 401 when not signed in', async () => {
    const postingId = await insertPosting();
    const response = await route.POST(new Request(`http://localhost/api/applications/${postingId}`, { method: 'POST' }), {
      params: Promise.resolve({ postingId }),
    });
    expect(response.status).toBe(401);
  });

  it('DELETE returns 401 when not signed in', async () => {
    const postingId = await insertPosting();
    const response = await route.DELETE(new Request(`http://localhost/api/applications/${postingId}`, { method: 'DELETE' }), {
      params: Promise.resolve({ postingId }),
    });
    expect(response.status).toBe(401);
  });

  it('POST returns 400 for a malformed posting id', async () => {
    const { cookie } = await signedInUser();
    const response = await route.POST(
      new Request('http://localhost/api/applications/not-a-uuid', { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ postingId: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(400);
  });

  it('DELETE returns 400 for a malformed posting id', async () => {
    const { cookie } = await signedInUser();
    const response = await route.DELETE(
      new Request('http://localhost/api/applications/not-a-uuid', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ postingId: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(400);
  });

  it('POST marks a posting applied and is idempotent', async () => {
    const { userId, cookie } = await signedInUser();
    const postingId = await insertPosting();

    const first = await route.POST(
      new Request(`http://localhost/api/applications/${postingId}`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );
    const second = await route.POST(
      new Request(`http://localhost/api/applications/${postingId}`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ applied: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ applied: true });
    const rows = await sql`select * from applications where user_id = ${userId} and posting_id = ${postingId}`;
    expect(rows).toHaveLength(1);
  });

  it('DELETE unmarks a posting and is a no-op when nothing exists', async () => {
    const { userId, cookie } = await signedInUser();
    const postingId = await insertPosting();
    await route.POST(
      new Request(`http://localhost/api/applications/${postingId}`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );

    const first = await route.DELETE(
      new Request(`http://localhost/api/applications/${postingId}`, { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );
    const second = await route.DELETE(
      new Request(`http://localhost/api/applications/${postingId}`, { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ postingId }) },
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ applied: false });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ applied: false });
    const rows = await sql`select * from applications where user_id = ${userId} and posting_id = ${postingId}`;
    expect(rows).toHaveLength(0);
  });
});

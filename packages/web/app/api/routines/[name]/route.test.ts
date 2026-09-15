import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/routines/[name]', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let routinesDb: typeof import('../../../../lib/routines-db.ts');
  let route: typeof import('./route.ts');
  let listRoute: typeof import('../route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    routinesDb = await import('../../../../lib/routines-db.ts');
    route = await import('./route.ts');
    listRoute = await import('../route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from routines`;
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

  it('PUT returns 401 when not signed in', async () => {
    const response = await route.PUT(new Request('http://localhost/api/routines/daily', { method: 'PUT' }), {
      params: Promise.resolve({ name: 'daily' }),
    });
    expect(response.status).toBe(401);
  });

  it('DELETE returns 401 when not signed in', async () => {
    const response = await route.DELETE(new Request('http://localhost/api/routines/daily', { method: 'DELETE' }), {
      params: Promise.resolve({ name: 'daily' }),
    });
    expect(response.status).toBe(401);
  });

  it('PUT returns 404 for a routine name that does not exist for this user', async () => {
    const { cookie } = await signedInUser();
    const response = await route.PUT(
      new Request('http://localhost/api/routines/nope', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ name: 'nope' }) },
    );
    expect(response.status).toBe(404);
  });

  it('DELETE returns 404 for a routine name that does not exist for this user', async () => {
    const { cookie } = await signedInUser();
    const response = await route.DELETE(
      new Request('http://localhost/api/routines/nope', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ name: 'nope' }) },
    );
    expect(response.status).toBe(404);
  });

  it('PUT updates and returns the routine', async () => {
    const { userId, cookie } = await signedInUser();
    await routinesDb.createRoutine(userId, 'daily', { q: 'old' }, null, null);

    const response = await route.PUT(
      new Request('http://localhost/api/routines/daily', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: 'new query',
          company: 'Acme,Globex',
          judge_prompt: 'judge it',
          destination_tab: 'shortlist',
        }),
      }),
      { params: Promise.resolve({ name: 'daily' }) },
    );
    const body = await response.json();
    expect(body.name).toBe('daily');
    expect(body.filters.q).toBe('new query');
    expect(body.filters.company).toEqual(['Acme', 'Globex']);
    expect(body.judge_prompt).toBe('judge it');
    expect(body.destination_tab).toBe('shortlist');
  });

  it('DELETE returns {deleted: true} and the routine no longer appears in a subsequent GET', async () => {
    const { userId, cookie } = await signedInUser();
    await routinesDb.createRoutine(userId, 'daily', {}, null, null);

    const response = await route.DELETE(
      new Request('http://localhost/api/routines/daily', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ name: 'daily' }) },
    );
    expect(await response.json()).toEqual({ deleted: true });

    const listResponse = await listRoute.GET(new Request('http://localhost/api/routines', { headers: { cookie } }));
    expect(await listResponse.json()).toEqual({ rows: [] });
  });
});

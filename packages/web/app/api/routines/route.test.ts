import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/routines', () => {
  let authDb: typeof import('../../../lib/auth-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../lib/auth-db.ts');
    route = await import('./route.ts');
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

  async function signedInCookie(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return sessionCookieHeader(sealed).split(';')[0]!;
  }

  it('GET returns 401 when not signed in', async () => {
    const response = await route.GET(new Request('http://localhost/api/routines'));
    expect(response.status).toBe(401);
  });

  it('GET returns an empty rows array for a signed-in user with no routines', async () => {
    const cookie = await signedInCookie();
    const response = await route.GET(new Request('http://localhost/api/routines', { headers: { cookie } }));
    expect(await response.json()).toEqual({ rows: [] });
  });

  it('POST returns 401 when not signed in', async () => {
    const response = await route.POST(new Request('http://localhost/api/routines', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('POST rejects a blank name', async () => {
    const cookie = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/routines', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '  ' }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('POST rejects a duplicate name for the same user', async () => {
    const cookie = await signedInCookie();
    const create = () =>
      route.POST(
        new Request('http://localhost/api/routines', {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'daily' }),
        }),
      );
    await create();
    const second = await create();
    expect(second.status).toBe(400);
    expect((await second.json()).error).toMatch(/already exists/i);
  });

  it('POST creates a routine and returns it in rows, splitting company into an array', async () => {
    const cookie = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/routines', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'daily',
          q: 'engineer',
          company: 'Acme,Globex',
          judge_prompt: 'judge it',
          destination_tab: 'shortlist',
        }),
      }),
    );
    const body = await response.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].name).toBe('daily');
    expect(body.rows[0].filters.company).toEqual(['Acme', 'Globex']);
    expect(body.rows[0].judge_prompt).toBe('judge it');
    expect(body.rows[0].destination_tab).toBe('shortlist');
  });
});

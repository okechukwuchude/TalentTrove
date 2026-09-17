import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/user-preferences', () => {
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
    await sql`delete from user_preferences`;
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
    const response = await route.GET(new Request('http://localhost/api/user-preferences'));
    expect(response.status).toBe(401);
  });

  it('GET returns empty defaults for an account with nothing stored', async () => {
    const cookie = await signedInCookie();
    const response = await route.GET(new Request('http://localhost/api/user-preferences', { headers: { cookie } }));
    expect(await response.json()).toEqual({ roles: [], countries: [] });
  });

  it('PUT saves roles/countries, which GET then reflects', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['staff engineer'], countries: ['us', 'gb'] }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/user-preferences', { headers: { cookie } }));
    expect(await response.json()).toEqual({ roles: ['staff engineer'], countries: ['us', 'gb'] });
  });

  it('PUT rejects more than 5 roles', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['a', 'b', 'c', 'd', 'e', 'f'], countries: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('PUT rejects more than 3 countries', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [], countries: ['us', 'gb', 'ca', 'de'] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('PUT rejects a country code Adzuna does not support', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [], countries: ['zz'] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('PUT rejects a non-array body', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/user-preferences', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: 'not-an-array', countries: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

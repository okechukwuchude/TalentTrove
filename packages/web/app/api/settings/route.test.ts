import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/settings', () => {
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
    await sql`delete from app_settings`;
    await sql`delete from sessions`;
    await sql`delete from users`;
    delete process.env.JSEARCH_QUERIES;
    delete process.env.JSEARCH_API_KEY;
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
    const response = await route.GET(new Request('http://localhost/api/settings'));
    expect(response.status).toBe(401);
  });

  it('GET reflects env-var fallback values and unset secrets', async () => {
    process.env.JSEARCH_QUERIES = 'staff engineer';
    process.env.JSEARCH_API_KEY = 'env-key';
    const cookie = await signedInCookie();
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null; isSet: boolean; secret: boolean }[] };
    const queries = body.items.find((item) => item.key === 'jsearch_queries');
    const apiKey = body.items.find((item) => item.key === 'jsearch_api_key');
    expect(queries).toMatchObject({ value: 'staff engineer', isSet: true, secret: false });
    expect(apiKey).toMatchObject({ value: null, isSet: true, secret: true });
  });

  it('PUT saves a non-secret value, which GET then reflects', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_queries: 'backend engineer' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null }[] };
    expect(body.items.find((item) => item.key === 'jsearch_queries')?.value).toBe('backend engineer');
  });

  it('PUT saves a secret value encrypted, which GET reflects only as isSet', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_api_key: 'a-real-key' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null; isSet: boolean }[] };
    expect(body.items.find((item) => item.key === 'jsearch_api_key')).toMatchObject({ value: null, isSet: true });

    const [row] = await sql`select value from app_settings where key = 'jsearch_api_key'`;
    expect(row!['value']).not.toBe('a-real-key');
  });

  it('PUT with an empty string clears a saved value, reverting to the env fallback', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_queries: 'backend engineer' }),
      }),
    );
    process.env.JSEARCH_QUERIES = 'env fallback query';
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsearch_queries: '' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null }[] };
    expect(body.items.find((item) => item.key === 'jsearch_queries')?.value).toBe('env fallback query');
  });

  it('PUT rejects an unknown key', async () => {
    const cookie = await signedInCookie();
    const response = await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ not_a_real_key: 'x' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

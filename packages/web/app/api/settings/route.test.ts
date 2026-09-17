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
    delete process.env.GREENHOUSE_COMPANIES;
    delete process.env.JSEARCH_API_KEY;
    delete process.env.SETTINGS_ADMIN_EMAILS;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookieForEmail(email: string): Promise<string> {
    const user = await authDb.createUser(email, 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return sessionCookieHeader(sealed).split(';')[0]!;
  }

  async function signedInCookie(): Promise<string> {
    return signedInCookieForEmail(`${crypto.randomUUID()}@example.com`);
  }

  it('GET returns 401 when not signed in', async () => {
    const response = await route.GET(new Request('http://localhost/api/settings'));
    expect(response.status).toBe(401);
  });

  it('GET reflects env-var fallback values and unset secrets', async () => {
    process.env.GREENHOUSE_COMPANIES = 'stripe:Stripe';
    process.env.JSEARCH_API_KEY = 'env-key';
    const cookie = await signedInCookie();
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null; isSet: boolean; secret: boolean }[] };
    const queries = body.items.find((item) => item.key === 'greenhouse_companies');
    const apiKey = body.items.find((item) => item.key === 'jsearch_api_key');
    expect(queries).toMatchObject({ value: 'stripe:Stripe', isSet: true, secret: false });
    expect(apiKey).toMatchObject({ value: null, isSet: true, secret: true });
  });

  it('PUT saves a non-secret value, which GET then reflects', async () => {
    const cookie = await signedInCookie();
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ greenhouse_companies: 'figma:Figma' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null }[] };
    expect(body.items.find((item) => item.key === 'greenhouse_companies')?.value).toBe('figma:Figma');
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
        body: JSON.stringify({ greenhouse_companies: 'figma:Figma' }),
      }),
    );
    process.env.GREENHOUSE_COMPANIES = 'env:Fallback';
    await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ greenhouse_companies: '' }),
      }),
    );
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    const body = (await response.json()) as { items: { key: string; value: string | null }[] };
    expect(body.items.find((item) => item.key === 'greenhouse_companies')?.value).toBe('env:Fallback');
  });

  it('GET returns 403 when SETTINGS_ADMIN_EMAILS is set and the signed-in email is not in it', async () => {
    process.env.SETTINGS_ADMIN_EMAILS = 'owner@example.com';
    const cookie = await signedInCookieForEmail('someone-else@example.com');
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    expect(response.status).toBe(403);
  });

  it('GET succeeds when the signed-in email is in SETTINGS_ADMIN_EMAILS', async () => {
    process.env.SETTINGS_ADMIN_EMAILS = 'owner@example.com';
    const cookie = await signedInCookieForEmail('owner@example.com');
    const response = await route.GET(new Request('http://localhost/api/settings', { headers: { cookie } }));
    expect(response.status).toBe(200);
  });

  it('PUT returns 403 when SETTINGS_ADMIN_EMAILS is set and the signed-in email is not in it', async () => {
    process.env.SETTINGS_ADMIN_EMAILS = 'owner@example.com';
    const cookie = await signedInCookieForEmail('someone-else@example.com');
    const response = await route.PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ greenhouse_companies: 'x:X' }),
      }),
    );
    expect(response.status).toBe(403);
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

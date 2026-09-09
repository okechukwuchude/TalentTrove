import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe.skipIf(!testDatabaseUrl)('POST /api/auth/logout', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let POST: typeof import('./route.ts')['POST'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    ({ POST } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('deletes the session row and clears the cookie', async () => {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;

    const response = await POST(new Request('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie } }));

    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await authDb.resolveSessionToken(token)).toBeNull();
  });

  it('is a no-op, not an error, when there is no session cookie', async () => {
    const response = await POST(new Request('http://localhost/api/auth/logout', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedIn: false });
  });
});

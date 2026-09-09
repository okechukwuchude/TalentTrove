import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const params = (name: string) => ({ params: Promise.resolve({ name }) });

describe.skipIf(!testDatabaseUrl)('POST /api/tabs/[name]/remove', () => {
  let authDb: typeof import('../../../../../lib/auth-db.ts');
  let POST: typeof import('./route.ts')['POST'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../../lib/auth-db.ts');
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

  async function signedInCookie(): Promise<string> {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return sessionCookieHeader(sealed).split(';')[0]!;
  }

  it('returns 401 when not signed in', async () => {
    const response = await POST(new Request('http://localhost/api/tabs/main/remove', { method: 'POST' }), params('main'));
    expect(response.status).toBe(401);
  });

  it('returns 501 when signed in', async () => {
    const cookie = await signedInCookie();
    const response = await POST(
      new Request('http://localhost/api/tabs/main/remove', { method: 'POST', headers: { cookie } }),
      params('main'),
    );
    expect(response.status).toBe(501);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe.skipIf(!testDatabaseUrl)('GET /api/auth/session', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let GET: typeof import('./route.ts')['GET'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    ({ GET } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('reports signed out when there is no session cookie', async () => {
    const response = await GET(new Request('http://localhost/api/auth/session'));
    expect(await response.json()).toEqual({ signedIn: false });
  });

  it('reports signed in with the email when a valid session cookie is present', async () => {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;
    const request = new Request('http://localhost/api/auth/session', { headers: { cookie } });

    const response = await GET(request);
    expect(await response.json()).toEqual({ signedIn: true, email: 'a@example.com' });
  });
});

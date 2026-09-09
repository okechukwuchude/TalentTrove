import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { hashPassword } from '../../../../lib/passwords.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!testDatabaseUrl)('POST /api/auth/sign-in', () => {
  let POST: typeof import('./route.ts')['POST'];
  let authDb: typeof import('../../../../lib/auth-db.ts');
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

  async function seedUser(email: string, password: string): Promise<void> {
    await authDb.createUser(email, await hashPassword(password));
  }

  it('signs in with the right password and sets a session cookie', async () => {
    await seedUser('a@example.com', 'password123');
    const response = await POST(jsonRequest({ email: 'a@example.com', password: 'password123' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'a@example.com' });
    expect(response.headers.get('set-cookie')).toContain('pinloop_session=');
  });

  it('gives the same generic error for a nonexistent email as for a wrong password', async () => {
    await seedUser('a@example.com', 'password123');
    const noSuchUser = await POST(jsonRequest({ email: 'nobody@example.com', password: 'whatever1' }));
    const wrongPassword = await POST(jsonRequest({ email: 'a@example.com', password: 'wrong-password' }));

    expect(noSuchUser.status).toBe(400);
    expect(wrongPassword.status).toBe(400);
    const [noSuchBody, wrongBody] = await Promise.all([noSuchUser.json(), wrongPassword.json()]);
    expect(noSuchBody.error).toBe('that email or password is wrong');
    expect(wrongBody.error).toBe('that email or password is wrong');
  });

  it('locks the account after 5 failed attempts', async () => {
    await seedUser('lockout@example.com', 'password123');
    for (let i = 0; i < 5; i++) {
      await POST(jsonRequest({ email: 'lockout@example.com', password: 'wrong-password' }));
    }

    const response = await POST(jsonRequest({ email: 'lockout@example.com', password: 'password123' }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatch(/too many attempts/i);
  });

  it('a successful sign-in resets the failed-attempt counter', async () => {
    await seedUser('a@example.com', 'password123');
    await POST(jsonRequest({ email: 'a@example.com', password: 'wrong-password' }));
    await POST(jsonRequest({ email: 'a@example.com', password: 'password123' }));

    const user = await authDb.findUserByEmail('a@example.com');
    expect(user?.failedAttempts).toBe(0);
  });
});

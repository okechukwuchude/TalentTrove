import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';
import { sealSession, sessionCookieHeader } from './session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe.skipIf(!testDatabaseUrl)('readCurrentUser / requireSession', () => {
  let authDb: typeof import('./auth-db.ts');
  let requireSessionModule: typeof import('./require-session.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    requireSessionModule = await import('./require-session.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('readCurrentUser returns null when there is no cookie at all', async () => {
    expect(await requireSessionModule.readCurrentUser(null)).toBeNull();
  });

  it('readCurrentUser returns the user for a valid session cookie', async () => {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;

    expect(await requireSessionModule.readCurrentUser(cookie)).toEqual({ userId: user.id, email: 'a@example.com' });
  });

  it('readCurrentUser returns null for a session that was deleted', async () => {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    await authDb.deleteSession(token);
    const sealed = await sealSession({ token });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;

    expect(await requireSessionModule.readCurrentUser(cookie)).toBeNull();
  });

  it('requireSession returns the user when a valid session cookie is present', async () => {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    const cookie = sessionCookieHeader(sealed).split(';')[0]!;
    const request = new Request('http://localhost/api/profile', { headers: { cookie } });

    const result = await requireSessionModule.requireSession(request);
    expect('unauthorized' in result).toBe(false);
    if ('unauthorized' in result) return;
    expect(result.user).toEqual({ userId: user.id, email: 'a@example.com' });
  });

  it('requireSession returns a 401 response when there is no session cookie', async () => {
    const request = new Request('http://localhost/api/profile');
    const result = await requireSessionModule.requireSession(request);
    expect('unauthorized' in result).toBe(true);
    if (!('unauthorized' in result)) return;
    expect(result.unauthorized.status).toBe(401);
  });
});

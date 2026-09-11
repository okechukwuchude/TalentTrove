import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('POST /api/tabs/[name]/rename', () => {
  let authDb: typeof import('../../../../../lib/auth-db.ts');
  let tabsDb: typeof import('../../../../../lib/tabs-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../../lib/auth-db.ts');
    tabsDb = await import('../../../../../lib/tabs-db.ts');
    route = await import('./route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from tab_items`;
    await sql`delete from tabs`;
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

  function renameRequest(name: string, cookie: string, to: unknown): Request {
    return new Request(`http://localhost/api/tabs/${name}/rename`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    });
  }

  it('returns 401 when not signed in', async () => {
    const response = await route.POST(new Request('http://localhost/api/tabs/shortlist/rename', { method: 'POST' }), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a tab the caller does not have', async () => {
    const { cookie } = await signedInUser();
    const response = await route.POST(renameRequest('nope', cookie, 'renamed'), {
      params: Promise.resolve({ name: 'nope' }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 400 for a blank target name', async () => {
    const { userId, cookie } = await signedInUser();
    await tabsDb.createTab(userId, 'shortlist', null);
    const response = await route.POST(renameRequest('shortlist', cookie, '  '), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    expect(response.status).toBe(400);
  });

  it('renames the tab', async () => {
    const { userId, cookie } = await signedInUser();
    await tabsDb.createTab(userId, 'shortlist', null);
    const response = await route.POST(renameRequest('shortlist', cookie, 'renamed'), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    expect(response.status).toBe(200);
    expect(await tabsDb.findTabByName(userId, 'renamed')).not.toBeNull();
    expect(await tabsDb.findTabByName(userId, 'shortlist')).toBeNull();
  });
});

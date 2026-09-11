import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('/api/tabs/[name]', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let tabsDb: typeof import('../../../../lib/tabs-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    tabsDb = await import('../../../../lib/tabs-db.ts');
    route = await import('./route.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from tab_items`;
    await sql`delete from postings`;
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

  it('GET returns 401 when not signed in', async () => {
    const response = await route.GET(new Request('http://localhost/api/tabs/shortlist'), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    expect(response.status).toBe(401);
  });

  it('GET returns 404 for a tab the caller does not have', async () => {
    const { cookie } = await signedInUser();
    const response = await route.GET(new Request('http://localhost/api/tabs/nope', { headers: { cookie } }), {
      params: Promise.resolve({ name: 'nope' }),
    });
    expect(response.status).toBe(404);
  });

  it('GET returns rows, cursor, and no_longer_present', async () => {
    const { userId, cookie } = await signedInUser();
    const [row] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source) values ('Staff Engineer', 'Acme', 'https://x/p1', 'seed') returning id
    `;
    const postingId = row!.id;
    await tabsDb.createTab(userId, 'shortlist', null);
    const tab = await tabsDb.findTabByName(userId, 'shortlist');
    await tabsDb.addPostingsToTab(userId, tab!.id, [postingId]);

    const response = await route.GET(new Request('http://localhost/api/tabs/shortlist?limit=20', { headers: { cookie } }), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    const body = await response.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].title).toBe('Staff Engineer');
    expect(body.cursor).toBeNull();
    expect(body.no_longer_present).toEqual([]);
  });

  it('DELETE returns 401 when not signed in', async () => {
    const response = await route.DELETE(new Request('http://localhost/api/tabs/shortlist', { method: 'DELETE' }), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    expect(response.status).toBe(401);
  });

  it('DELETE returns 404 for a tab the caller does not have', async () => {
    const { cookie } = await signedInUser();
    const response = await route.DELETE(
      new Request('http://localhost/api/tabs/nope', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ name: 'nope' }) },
    );
    expect(response.status).toBe(404);
  });

  it('DELETE removes the tab', async () => {
    const { userId, cookie } = await signedInUser();
    await tabsDb.createTab(userId, 'shortlist', null);
    const response = await route.DELETE(
      new Request('http://localhost/api/tabs/shortlist', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ name: 'shortlist' }) },
    );
    expect(await response.json()).toEqual({ deleted: true });
    expect(await tabsDb.findTabByName(userId, 'shortlist')).toBeNull();
  });
});

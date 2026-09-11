import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('POST /api/tabs/[name]/remove', () => {
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

  function removeRequest(name: string, cookie: string, itemIds: unknown): Request {
    return new Request(`http://localhost/api/tabs/${name}/remove`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: itemIds }),
    });
  }

  it('returns 404 for a tab the caller does not have', async () => {
    const { cookie } = await signedInUser();
    const response = await route.POST(removeRequest('nope', cookie, ['i1']), {
      params: Promise.resolve({ name: 'nope' }),
    });
    expect(response.status).toBe(404);
  });

  it('refuses a request with no item_ids', async () => {
    const { userId, cookie } = await signedInUser();
    await tabsDb.createTab(userId, 'shortlist', null);
    const response = await route.POST(removeRequest('shortlist', cookie, []), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    expect(response.status).toBe(400);
  });

  it('removes the item ids and reports not_found, with coverage', async () => {
    const { userId, cookie } = await signedInUser();
    const [row] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source) values ('Staff Engineer', 'Acme', 'https://x/p1', 'seed') returning id
    `;
    const postingId = row!.id;
    await tabsDb.createTab(userId, 'shortlist', null);
    const tab = await tabsDb.findTabByName(userId, 'shortlist');
    const added = await tabsDb.addPostingsToTab(userId, tab!.id, [postingId]);
    const itemId = added!.rows[0]!.item_id!;

    const response = await route.POST(removeRequest('shortlist', cookie, [itemId, 'not-a-real-item']), {
      params: Promise.resolve({ name: 'shortlist' }),
    });
    const body = await response.json();
    expect(body.rows).toEqual([]);
    expect(body.not_found).toEqual(['not-a-real-item']);
    expect(body.coverage).toEqual({ covered: 1, total: 2 });
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('tabs-db', () => {
  let authDb: typeof import('./auth-db.ts');
  let tabsDb: typeof import('./tabs-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    tabsDb = await import('./tabs-db.ts');
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

  async function freshUserId(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    return user.id;
  }

  async function insertPosting(overrides: Partial<{ title: string; company: string; url: string }> = {}): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into postings (title, company, url, source)
      values (${overrides.title ?? 'Staff Engineer'}, ${overrides.company ?? 'Acme'}, ${overrides.url ?? `https://example.com/job/${crypto.randomUUID()}`}, 'seed')
      returning id
    `;
    return row!.id;
  }

  it('returns an empty list for a user with no tabs', async () => {
    const userId = await freshUserId();
    expect(await tabsDb.listTabs(userId)).toEqual([]);
  });

  it('creates a tab and lists it with items: 0', async () => {
    const userId = await freshUserId();
    await tabsDb.createTab(userId, 'shortlist', 'jobs to revisit');
    expect(await tabsDb.listTabs(userId)).toEqual([{ name: 'shortlist', description: 'jobs to revisit', items: 0 }]);
  });

  it('lets two different users each have a tab named the same thing', async () => {
    const userA = await freshUserId();
    const userB = await freshUserId();
    await tabsDb.createTab(userA, 'shortlist', null);
    await tabsDb.createTab(userB, 'shortlist', null);
    expect(await tabsDb.listTabs(userA)).toHaveLength(1);
    expect(await tabsDb.listTabs(userB)).toHaveLength(1);
  });

  it('findTabByName returns null when there is no such tab for this user', async () => {
    const userId = await freshUserId();
    expect(await tabsDb.findTabByName(userId, 'nope')).toBeNull();
  });

  it('renameTab only renames the tab if it belongs to the calling user', async () => {
    const owner = await freshUserId();
    const stranger = await freshUserId();
    const tab = await tabsDb.createTab(owner, 'shortlist', null);
    const found = await tabsDb.findTabByName(owner, tab.name);

    await tabsDb.renameTab(stranger, found!.id, 'stolen');
    expect(await tabsDb.findTabByName(owner, 'shortlist')).not.toBeNull();
    expect(await tabsDb.findTabByName(owner, 'stolen')).toBeNull();

    await tabsDb.renameTab(owner, found!.id, 'renamed');
    expect(await tabsDb.findTabByName(owner, 'renamed')).not.toBeNull();
  });

  it('deleteTab removes the tab and cascades its items', async () => {
    const userId = await freshUserId();
    const postingId = await insertPosting();
    await tabsDb.createTab(userId, 'shortlist', null);
    const tab = await tabsDb.findTabByName(userId, 'shortlist');
    await tabsDb.addPostingsToTab(userId, tab!.id, [postingId]);

    await tabsDb.deleteTab(userId, tab!.id);

    expect(await tabsDb.findTabByName(userId, 'shortlist')).toBeNull();
    const rows = await sql<{ count: string }[]>`select count(*) from tab_items where tab_id = ${tab!.id}`;
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('getTabContents returns null for a tab that does not belong to the caller', async () => {
    const owner = await freshUserId();
    const stranger = await freshUserId();
    await tabsDb.createTab(owner, 'shortlist', null);
    const tab = await tabsDb.findTabByName(owner, 'shortlist');
    expect(await tabsDb.getTabContents(stranger, tab!.id, 20, null)).toBeNull();
  });

  it('getTabContents returns postings still present and reports the rest as no_longer_present', async () => {
    const userId = await freshUserId();
    const stillThere = await insertPosting({ title: 'Staff Engineer' });
    const removed = await insertPosting({ title: 'Will vanish' });
    await tabsDb.createTab(userId, 'shortlist', null);
    const tab = await tabsDb.findTabByName(userId, 'shortlist');
    await tabsDb.addPostingsToTab(userId, tab!.id, [stillThere, removed]);
    await sql`delete from postings where id = ${removed}`;

    const page = await tabsDb.getTabContents(userId, tab!.id, 20, null);

    expect(page!.rows).toHaveLength(1);
    expect(page!.rows[0]!.title).toBe('Staff Engineer');
    expect(page!.rows[0]!.item_id).toBeTruthy();
    expect(page!.noLongerPresent).toEqual([{ postingId: removed, itemId: expect.any(String) }]);
    expect(page!.cursor).toBeNull();
  });

  it('getTabContents paginates with a cursor', async () => {
    const userId = await freshUserId();
    await tabsDb.createTab(userId, 'shortlist', null);
    const tab = await tabsDb.findTabByName(userId, 'shortlist');
    const ids = [await insertPosting({ title: 'A' }), await insertPosting({ title: 'B' }), await insertPosting({ title: 'C' })];
    await tabsDb.addPostingsToTab(userId, tab!.id, ids);

    const firstPage = await tabsDb.getTabContents(userId, tab!.id, 2, null);
    expect(firstPage!.rows).toHaveLength(2);
    expect(firstPage!.cursor).toBeTruthy();

    const secondPage = await tabsDb.getTabContents(userId, tab!.id, 2, firstPage!.cursor);
    expect(secondPage!.rows).toHaveLength(1);
    expect(secondPage!.cursor).toBeNull();
  });

  it('addPostingsToTab reports unknown ids and already-present ids, and returns null for an unowned tab', async () => {
    const owner = await freshUserId();
    const stranger = await freshUserId();
    const postingId = await insertPosting();
    await tabsDb.createTab(owner, 'shortlist', null);
    const tab = await tabsDb.findTabByName(owner, 'shortlist');

    expect(await tabsDb.addPostingsToTab(stranger, tab!.id, [postingId])).toBeNull();

    const first = await tabsDb.addPostingsToTab(owner, tab!.id, [postingId, 'not-a-real-id']);
    expect(first!.rows).toHaveLength(1);
    expect(first!.unknown).toEqual(['not-a-real-id']);
    expect(first!.alreadyPresent).toEqual([]);
    expect(first!.covered).toBe(1);

    const second = await tabsDb.addPostingsToTab(owner, tab!.id, [postingId]);
    expect(second!.alreadyPresent).toEqual([postingId]);
    expect(second!.covered).toBe(0);
  });

  it('removeFromTab reports not_found ids, removes the rest, and returns null for an unowned tab', async () => {
    const owner = await freshUserId();
    const stranger = await freshUserId();
    const postingId = await insertPosting();
    await tabsDb.createTab(owner, 'shortlist', null);
    const tab = await tabsDb.findTabByName(owner, 'shortlist');
    const added = await tabsDb.addPostingsToTab(owner, tab!.id, [postingId]);
    const itemId = added!.rows[0]!.item_id!;

    expect(await tabsDb.removeFromTab(stranger, tab!.id, [itemId])).toBeNull();

    const result = await tabsDb.removeFromTab(owner, tab!.id, [itemId, 'not-a-real-item']);
    expect(result!.notFound).toEqual(['not-a-real-item']);
    expect(result!.covered).toBe(1);
    expect(result!.rows).toEqual([]);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('loadDistinctQueryPairs', () => {
  let authDb: typeof import('../auth-db.ts');
  let userPreferencesDb: typeof import('../user-preferences-db.ts');
  let userQueryPairs: typeof import('./user-query-pairs.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../auth-db.ts');
    userPreferencesDb = await import('../user-preferences-db.ts');
    userQueryPairs = await import('./user-query-pairs.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from user_preferences`;
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

  it('returns an empty list when no account has preferences', async () => {
    expect(await userQueryPairs.loadDistinctQueryPairs()).toEqual([]);
  });

  it("returns the cross product of one account's roles and countries", async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['backend engineer', 'staff engineer'], ['us', 'gb']);

    const pairs = await userQueryPairs.loadDistinctQueryPairs();
    expect(pairs).toHaveLength(4);
    expect(pairs).toEqual(
      expect.arrayContaining([
        { role: 'backend engineer', country: 'us' },
        { role: 'backend engineer', country: 'gb' },
        { role: 'staff engineer', country: 'us' },
        { role: 'staff engineer', country: 'gb' },
      ]),
    );
  });

  it('dedupes an identical pair shared by two accounts', async () => {
    const userA = await freshUserId();
    const userB = await freshUserId();
    await userPreferencesDb.setUserPreferences(userA, ['backend engineer'], ['us']);
    await userPreferencesDb.setUserPreferences(userB, ['backend engineer'], ['us']);

    const pairs = await userQueryPairs.loadDistinctQueryPairs();
    expect(pairs).toEqual([{ role: 'backend engineer', country: 'us' }]);
  });

  it('contributes nothing for an account with only roles or only countries set', async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['backend engineer'], []);

    expect(await userQueryPairs.loadDistinctQueryPairs()).toEqual([]);
  });
});

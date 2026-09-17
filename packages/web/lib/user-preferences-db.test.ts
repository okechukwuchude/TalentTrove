import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('user-preferences-db', () => {
  let authDb: typeof import('./auth-db.ts');
  let userPreferencesDb: typeof import('./user-preferences-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    userPreferencesDb = await import('./user-preferences-db.ts');
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

  it('returns null for a user with no stored preferences', async () => {
    const userId = await freshUserId();
    expect(await userPreferencesDb.getUserPreferences(userId)).toBeNull();
  });

  it('stores and retrieves roles and countries', async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['staff software engineer'], ['us', 'gb']);
    expect(await userPreferencesDb.getUserPreferences(userId)).toEqual({
      roles: ['staff software engineer'],
      countries: ['us', 'gb'],
    });
  });

  it('a second call overwrites rather than duplicating the row', async () => {
    const userId = await freshUserId();
    await userPreferencesDb.setUserPreferences(userId, ['role one'], ['us']);
    await userPreferencesDb.setUserPreferences(userId, ['role two'], ['gb']);

    expect(await userPreferencesDb.getUserPreferences(userId)).toEqual({ roles: ['role two'], countries: ['gb'] });
    const rows = await sql`select * from user_preferences where user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });
});

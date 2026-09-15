import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('settings-db', () => {
  let settingsDb: typeof import('./settings-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    settingsDb = await import('./settings-db.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from app_settings`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('returns null for a key that was never set', async () => {
    expect(await settingsDb.getSetting('jsearch_queries')).toBeNull();
    expect(await settingsDb.getSecretSetting('jsearch_api_key')).toBeNull();
  });

  it('round-trips a plain setting', async () => {
    await settingsDb.setSetting('jsearch_queries', 'staff engineer,backend engineer');
    expect(await settingsDb.getSetting('jsearch_queries')).toBe('staff engineer,backend engineer');
  });

  it('round-trips a secret setting, storing it encrypted', async () => {
    await settingsDb.setSecretSetting('jsearch_api_key', 'super-secret-key');
    expect(await settingsDb.getSecretSetting('jsearch_api_key')).toBe('super-secret-key');

    const [row] = await sql`select value from app_settings where key = 'jsearch_api_key'`;
    expect(row!['value']).not.toBe('super-secret-key');
  });

  it('setSetting overwrites an existing value for the same key', async () => {
    await settingsDb.setSetting('jsearch_queries', 'first');
    await settingsDb.setSetting('jsearch_queries', 'second');
    expect(await settingsDb.getSetting('jsearch_queries')).toBe('second');
  });

  it('clearSetting removes the row', async () => {
    await settingsDb.setSetting('jsearch_queries', 'staff engineer');
    await settingsDb.clearSetting('jsearch_queries');
    expect(await settingsDb.getSetting('jsearch_queries')).toBeNull();
  });
});

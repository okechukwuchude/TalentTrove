import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from './migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('schema migrations', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await runMigrations(testDatabaseUrl!);
    sql = postgres(testDatabaseUrl!);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('creates users, sessions, and password_reset_tokens', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
      and table_name in ('users', 'sessions', 'password_reset_tokens')
    `;
    const names = rows.map((row) => row.table_name).sort();
    expect(names).toEqual(['password_reset_tokens', 'sessions', 'users']);
  });

  it('creates profile_documents', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
      and table_name = 'profile_documents'
    `;
    expect(rows).toHaveLength(1);
  });
});

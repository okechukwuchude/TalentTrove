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

  it('creates postings, tabs, and tab_items', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
      and table_name in ('postings', 'tabs', 'tab_items')
    `;
    const names = rows.map((row) => row.table_name).sort();
    expect(names).toEqual(['tab_items', 'tabs', 'postings'].sort());
  });

  it('adds a country column and a unique url index to postings', async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'postings' and column_name = 'country'
    `;
    expect(columns).toHaveLength(1);

    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'postings' and indexname = 'postings_url_key'
    `;
    expect(indexes).toHaveLength(1);
  });

  it('adds a description column to postings and creates the judgments table', async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'postings' and column_name = 'description'
    `;
    expect(columns).toHaveLength(1);

    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'judgments'
    `;
    expect(tables).toHaveLength(1);

    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'judgments' and indexname = 'judgments_user_id_posting_id_key'
    `;
    expect(indexes).toHaveLength(1);
  });
});

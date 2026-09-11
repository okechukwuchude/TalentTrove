import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from './migrate.ts';
import { seedPostings } from './seed-postings.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('seedPostings', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await runMigrations(testDatabaseUrl!);
    sql = postgres(testDatabaseUrl!);
  });

  afterAll(async () => {
    await sql`delete from postings where source = 'seed'`;
    await sql.end();
  });

  it('inserts fake postings without throwing', async () => {
    await seedPostings(testDatabaseUrl!);
    const rows = await sql<{ count: string }[]>`select count(*) from postings where source = 'seed'`;
    expect(Number(rows[0]!.count)).toBeGreaterThan(0);
  });
});

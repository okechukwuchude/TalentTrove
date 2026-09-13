import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('runIngestion', () => {
  let runIngestion: typeof import('./run-ingestion.ts')['runIngestion'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    ({ runIngestion } = await import('./run-ingestion.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from postings`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('isolates one adapter\'s failure from the others and upserts by url', async () => {
    const failing = { name: 'broken', fetchPostings: async () => { throw new Error('boom'); } };
    const working = {
      name: 'working',
      fetchPostings: async () => [
        {
          title: 'Staff Engineer',
          company: 'Acme',
          url: 'https://example.com/jobs/run-ingestion-1',
          source: 'working',
        },
      ],
    };

    const summary = await runIngestion([failing, working]);

    expect(summary).toEqual([
      { source: 'broken', fetched: 0, upserted: 0, failed: 'boom' },
      { source: 'working', fetched: 1, upserted: 1, failed: null },
    ]);
    const rows = await sql<{ count: string }[]>`select count(*) from postings`;
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('dedupes duplicate urls within a single adapter batch, last one winning', async () => {
    const duplicated = {
      name: 'aggregator',
      fetchPostings: async () => [
        {
          title: 'First Match',
          company: 'Acme',
          url: 'https://example.com/jobs/run-ingestion-dup',
          source: 'aggregator',
        },
        {
          title: 'Second Match',
          company: 'Acme',
          url: 'https://example.com/jobs/run-ingestion-dup',
          source: 'aggregator',
        },
      ],
    };

    const summary = await runIngestion([duplicated]);

    expect(summary).toEqual([{ source: 'aggregator', fetched: 2, upserted: 1, failed: null }]);
    const rows = await sql<{ title: string }[]>`select title from postings where url = 'https://example.com/jobs/run-ingestion-dup'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Second Match');
  });

  it('upserts an existing url in place instead of duplicating it', async () => {
    const first = {
      name: 'source',
      fetchPostings: async () => [
        { title: 'Old Title', company: 'Acme', url: 'https://example.com/jobs/run-ingestion-2', source: 'source' },
      ],
    };
    const second = {
      name: 'source',
      fetchPostings: async () => [
        { title: 'New Title', company: 'Acme', url: 'https://example.com/jobs/run-ingestion-2', source: 'source' },
      ],
    };

    await runIngestion([first]);
    await runIngestion([second]);

    const rows = await sql<{ title: string }[]>`select title from postings where url = 'https://example.com/jobs/run-ingestion-2'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('New Title');
  });
});

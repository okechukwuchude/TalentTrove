import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('postings-search', () => {
  let searchPostings: typeof import('./postings-search.ts')['searchPostings'];
  let searchCompanies: typeof import('./postings-search.ts')['searchCompanies'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    ({ searchPostings, searchCompanies } = await import('./postings-search.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from postings`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function insertPosting(overrides: Partial<{
    title: string;
    company: string;
    country: string;
    workplace: string;
    employment: string;
    postedAt: string;
    url: string;
  }> = {}): Promise<void> {
    await sql`
      insert into postings (title, company, country, workplace, employment, posted_at, url, source)
      values (
        ${overrides.title ?? 'Staff Engineer'},
        ${overrides.company ?? 'Acme'},
        ${overrides.country ?? 'United States'},
        ${overrides.workplace ?? 'remote'},
        ${overrides.employment ?? 'full-time'},
        ${overrides.postedAt ?? '2026-09-01T00:00:00Z'},
        ${overrides.url ?? `https://example.com/jobs/${crypto.randomUUID()}`},
        'seed'
      )
    `;
  }

  it('ranks word matches and excludes non-matches', async () => {
    await insertPosting({ title: 'Staff Backend Engineer' });
    await insertPosting({ title: 'Marketing Manager' });

    const result = await searchPostings({ q: 'backend engineer' }, 20, null);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.title).toBe('Staff Backend Engineer');
  });

  it('orders by posted_at descending when there are no search words', async () => {
    await insertPosting({ title: 'Older', postedAt: '2026-08-01T00:00:00Z' });
    await insertPosting({ title: 'Newer', postedAt: '2026-09-01T00:00:00Z' });

    const result = await searchPostings({}, 20, null);

    expect(result.rows.map((row) => row.title)).toEqual(['Newer', 'Older']);
  });

  it('filters by workplace, employment, country (case-insensitive), and company', async () => {
    await insertPosting({ title: 'Match', workplace: 'remote', employment: 'full-time', country: 'United States', company: 'Acme' });
    await insertPosting({ title: 'Wrong workplace', workplace: 'onsite' });
    await insertPosting({ title: 'Wrong company', company: 'Globex' });

    const result = await searchPostings(
      { workplace: 'remote', employment: 'full-time', country: 'united states', company: ['Acme'] },
      20,
      null,
    );

    expect(result.rows.map((row) => row.title)).toEqual(['Match']);
  });

  it('normalizes the country filter so an abbreviation matches its canonical name without substring-matching an unrelated country', async () => {
    await insertPosting({ title: 'US role', country: 'United States' });
    await insertPosting({ title: 'Australian role', country: 'Australia' });

    const result = await searchPostings({ country: 'us' }, 20, null);

    expect(result.rows.map((row) => row.title)).toEqual(['US role']);
  });

  it('paginates with a cursor, no-search-words mode', async () => {
    await insertPosting({ title: 'A', postedAt: '2026-09-01T00:00:00Z' });
    await insertPosting({ title: 'B', postedAt: '2026-09-02T00:00:00Z' });
    await insertPosting({ title: 'C', postedAt: '2026-09-03T00:00:00Z' });

    const firstPage = await searchPostings({}, 2, null);
    expect(firstPage.rows.map((row) => row.title)).toEqual(['C', 'B']);
    expect(firstPage.cursor).toBeTruthy();

    const secondPage = await searchPostings({}, 2, firstPage.cursor);
    expect(secondPage.rows.map((row) => row.title)).toEqual(['A']);
    expect(secondPage.cursor).toBeNull();
  });

  it('paginates with a cursor in ranked-search mode without skipping or repeating tied rows', async () => {
    // Three postings that score identically under ts_rank (same title/company,
    // so the same tsvector and the same score against the same tsquery) —
    // this is exactly the case the rank cursor's `id`-tiebreak exists for.
    // Regression test for Task 10's self-review requirement: verify actual
    // cursor pagination behavior in the ranked-search branch, not just the
    // no-query branch the brief's own test suite covers.
    const urls = [1, 2, 3].map((n) => `https://example.com/jobs/tied-${n}-${crypto.randomUUID()}`);
    for (const url of urls) {
      await insertPosting({ title: 'Backend Engineer', company: 'Acme', url });
    }

    const firstPage = await searchPostings({ q: 'backend engineer' }, 2, null);
    expect(firstPage.rows).toHaveLength(2);
    expect(firstPage.cursor).toBeTruthy();

    const secondPage = await searchPostings({ q: 'backend engineer' }, 2, firstPage.cursor);
    expect(secondPage.rows).toHaveLength(1);
    expect(secondPage.cursor).toBeNull();

    const seenUrls = [...firstPage.rows, ...secondPage.rows].map((row) => row.url);
    expect(new Set(seenUrls).size).toBe(3); // no repeats across pages
    expect(seenUrls.sort()).toEqual([...urls].sort()); // no gaps either
  });

  it('paginates across a null-posted_at boundary in no-search-words mode', async () => {
    // Regression test for the reviewed bug: `posted_at desc nulls last`
    // means NULL-dated postings are real, expected results (a source that
    // never reported a posted date), and they sort after every dated
    // posting. When a page's *last* row has a NULL `posted_at`, the cursor
    // encodes its sort-key half as `''`. Before the fix, `decodeCursor`
    // rejected that cursor by JS truthiness (`!sortKey`) instead of by
    // shape, so the *following* page came back empty with `cursor: null`
    // instead of the remaining NULL-dated rows — silently truncating
    // pagination. With `limit: 1` this reproduces the exact boundary: page 1
    // ends on the one dated row, page 2 ends on the first NULL row (this is
    // the cursor that used to be misread as malformed), and page 3 must
    // still return the second NULL row rather than an empty page.
    await insertPosting({ title: 'Dated', postedAt: '2026-09-02T00:00:00Z' });
    await sql`
      insert into postings (title, company, country, workplace, employment, posted_at, url, source)
      values ('Null A', 'Acme', 'United States', 'remote', 'full-time', null, ${`https://example.com/jobs/${crypto.randomUUID()}`}, 'seed')
    `;
    await sql`
      insert into postings (title, company, country, workplace, employment, posted_at, url, source)
      values ('Null B', 'Acme', 'United States', 'remote', 'full-time', null, ${`https://example.com/jobs/${crypto.randomUUID()}`}, 'seed')
    `;

    const firstPage = await searchPostings({}, 1, null);
    expect(firstPage.rows.map((row) => row.title)).toEqual(['Dated']);
    expect(firstPage.cursor).toBeTruthy();

    const secondPage = await searchPostings({}, 1, firstPage.cursor);
    expect(secondPage.rows).toHaveLength(1);
    expect(['Null A', 'Null B']).toContain(secondPage.rows[0]!.title);
    expect(secondPage.cursor).toBeTruthy(); // one more NULL row remains

    const thirdPage = await searchPostings({}, 1, secondPage.cursor);
    expect(thirdPage.rows).toHaveLength(1); // must not be empty — this is the bug
    expect(thirdPage.cursor).toBeNull();

    const nullTitlesSeen = [secondPage.rows[0]!.title, thirdPage.rows[0]!.title].sort();
    expect(nullTitlesSeen).toEqual(['Null A', 'Null B']);
  });

  it('searchCompanies groups by company, counts postings, and requires at least 2 characters', async () => {
    await insertPosting({ company: 'Acme Corp' });
    await insertPosting({ company: 'Acme Corp' });
    await insertPosting({ company: 'Globex' });

    expect(await searchCompanies('a')).toEqual([]);
    expect(await searchCompanies('acme')).toEqual([{ id: 'Acme Corp', name: 'Acme Corp', posting_count: 2 }]);
  });
});

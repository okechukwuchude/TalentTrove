import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsearchAdapter } from './jsearch.ts';
import * as settingsDb from '../settings-db.ts';
import * as userQueryPairs from './user-query-pairs.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock('./user-query-pairs.ts', () => ({
  loadDistinctQueryPairs: vi.fn().mockResolvedValue([]),
}));

describe('jsearchAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockReset().mockResolvedValue([]);
    delete process.env.JSEARCH_API_KEY;
  });

  it('returns nothing and never calls fetch when no API key is configured', async () => {
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await jsearchAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing and never calls fetch when there are no query pairs', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await jsearchAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a JSearch response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          jobs: [
            {
              job_title: 'Staff Software Engineer',
              employer_name: 'Acme Corp',
              job_city: 'Remote',
              job_country: 'US',
              job_is_remote: true,
              job_employment_type: 'FULLTIME',
              job_posted_at_datetime_utc: '2026-09-01T00:00:00.000Z',
              job_apply_link: 'https://example.com/jobs/jsearch-1',
              job_description: 'We need a strong backend engineer with 5+ years experience.',
            },
            { job_title: 'Missing company and link' },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await jsearchAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Staff Software Engineer',
        company: 'Acme Corp',
        locations: ['Remote, US'],
        country: 'United States',
        workplace: 'remote',
        employment: 'full-time',
        description: 'We need a strong backend engineer with 5+ years experience.',
        postedAt: new Date('2026-09-01T00:00:00.000Z'),
        url: 'https://example.com/jobs/jsearch-1',
        source: 'jsearch',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('query=staff%20engineer'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'test-key' }) }),
    );
  });

  it("queries once per (role, country) pair, appending each pair's own country param", async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([
      { role: 'staff engineer', country: 'us' },
      { role: 'staff engineer', country: 'gb' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { jobs: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('&country=us'), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('&country=gb'), expect.anything());
  });

  it('prefers a DB-stored API key over the env var', async () => {
    process.env.JSEARCH_API_KEY = 'env-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) =>
      key === 'jsearch_api_key' ? 'db-key' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { jobs: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'db-key' }) }),
    );
  });
});

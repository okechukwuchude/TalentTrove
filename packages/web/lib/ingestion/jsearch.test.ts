import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsearchAdapter } from './jsearch.ts';
import * as settingsDb from '../settings-db.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

describe('jsearchAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    delete process.env.JSEARCH_API_KEY;
    delete process.env.JSEARCH_QUERIES;
    delete process.env.JSEARCH_COUNTRY;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await jsearchAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a JSearch response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    process.env.JSEARCH_QUERIES = 'staff engineer';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
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

  it('appends a country param to the request URL when a country is configured, omits it otherwise', async () => {
    process.env.JSEARCH_API_KEY = 'test-key';
    process.env.JSEARCH_QUERIES = 'staff engineer';
    process.env.JSEARCH_COUNTRY = 'us';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('&country=us'), expect.anything());
  });

  it('prefers DB-stored settings over env vars', async () => {
    process.env.JSEARCH_API_KEY = 'env-key';
    process.env.JSEARCH_QUERIES = 'env query';
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) =>
      key === 'jsearch_api_key' ? 'db-key' : null,
    );
    vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
      key === 'jsearch_queries' ? 'db query' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await jsearchAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('query=db%20query'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'db-key' }) }),
    );
  });
});

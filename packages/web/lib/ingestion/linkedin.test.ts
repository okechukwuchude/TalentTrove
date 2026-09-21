import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkedinAdapter } from './linkedin.ts';
import * as settingsDb from '../settings-db.ts';
import * as userQueryPairs from './user-query-pairs.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock('./user-query-pairs.ts', () => ({
  loadDistinctQueryPairs: vi.fn().mockResolvedValue([]),
}));

describe('linkedinAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockReset().mockResolvedValue([]);
    delete process.env.LINKEDIN_API_KEY;
  });

  it('returns nothing and never calls fetch when no API key is configured', async () => {
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'data engineer', country: 'gb' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await linkedinAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing and never calls fetch when there are no query pairs', async () => {
    process.env.LINKEDIN_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await linkedinAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an active-jb response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.LINKEDIN_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'data engineer', country: 'gb' }]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          title: 'Data Engineer',
          organization: 'Peaple Talent',
          url: 'https://uk.linkedin.com/jobs/view/data-engineer-at-peaple-talent-4467367663',
          locations_derived: ['Bristol, England, United Kingdom'],
          countries_derived: ['United Kingdom'],
          employment_type: ['FULL_TIME'],
          ai_work_arrangement: 'Hybrid',
          date_posted: '2026-09-21T08:32:21',
          ai_core_responsibilities: 'Build and maintain ETL pipelines.',
          ai_requirements_summary: 'Requires strong SQL and Python skills.',
        },
        { title: 'Missing company and link' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await linkedinAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Data Engineer',
        company: 'Peaple Talent',
        locations: ['Bristol, England, United Kingdom'],
        country: 'United Kingdom',
        workplace: 'hybrid',
        employment: 'full-time',
        description: 'Build and maintain ETL pipelines.\n\nRequires strong SQL and Python skills.',
        postedAt: new Date('2026-09-21T08:32:21'),
        url: 'https://uk.linkedin.com/jobs/view/data-engineer-at-peaple-talent-4467367663',
        source: 'linkedin',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('title=data%20engineer'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'test-key' }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('time_frame=24h'), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('limit=25'), expect.anything());
  });

  it("queries once per (role, country) pair, converting each pair's country code to its full name for the location param", async () => {
    process.env.LINKEDIN_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([
      { role: 'data engineer', country: 'us' },
      { role: 'data engineer', country: 'gb' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    await linkedinAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`location=${encodeURIComponent('United States')}`),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`location=${encodeURIComponent('United Kingdom')}`),
      expect.anything(),
    );
  });

  it('prefers a DB-stored API key over the env var', async () => {
    process.env.LINKEDIN_API_KEY = 'env-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'data engineer', country: 'gb' }]);
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) =>
      key === 'linkedin_api_key' ? 'db-key' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    await linkedinAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-RapidAPI-Key': 'db-key' }) }),
    );
  });

  it('drops a response job whose employment_type/ai_work_arrangement do not map to a known value', async () => {
    process.env.LINKEDIN_API_KEY = 'test-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'data engineer', country: 'gb' }]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          title: 'Data Engineer',
          organization: 'Acme',
          url: 'https://example.com/jobs/linkedin-1',
          employment_type: ['SOMETHING_ELSE'],
          ai_work_arrangement: 'Unknown',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await linkedinAdapter.fetchPostings();

    expect(rows).toEqual([
      expect.objectContaining({ employment: null, workplace: null, description: null, postedAt: null }),
    ]);
  });
});

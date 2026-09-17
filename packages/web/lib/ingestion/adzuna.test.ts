import { afterEach, describe, expect, it, vi } from 'vitest';
import { adzunaAdapter } from './adzuna.ts';
import * as settingsDb from '../settings-db.ts';
import * as userQueryPairs from './user-query-pairs.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecretSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock('./user-query-pairs.ts', () => ({
  loadDistinctQueryPairs: vi.fn().mockResolvedValue([]),
}));

describe('adzunaAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    vi.mocked(settingsDb.getSecretSetting).mockReset().mockResolvedValue(null);
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockReset().mockResolvedValue([]);
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await adzunaAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing and never calls fetch when there are no query pairs', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await adzunaAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an Adzuna response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Remote Backend Engineer',
            company: { display_name: 'Globex' },
            location: { display_name: 'Remote, US' },
            contract_time: 'full_time',
            created: '2026-09-02T00:00:00Z',
            redirect_url: 'https://example.com/jobs/adzuna-1',
            description: 'Full job description text.',
          },
          { title: 'Missing company and link' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await adzunaAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Remote Backend Engineer',
        company: 'Globex',
        locations: ['Remote, US'],
        country: 'United States',
        workplace: 'remote',
        employment: 'full-time',
        description: 'Full job description text.',
        postedAt: new Date('2026-09-02T00:00:00Z'),
        url: 'https://example.com/jobs/adzuna-1',
        source: 'adzuna',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/us/search/1'),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('queries once per (role, country) pair', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([
      { role: 'staff engineer', country: 'us' },
      { role: 'staff engineer', country: 'gb' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await adzunaAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/jobs/us/search/1'), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/jobs/gb/search/1'), expect.anything());
  });

  it('prefers DB-stored app id/key over env vars', async () => {
    process.env.ADZUNA_APP_ID = 'env-id';
    process.env.ADZUNA_APP_KEY = 'env-key';
    vi.mocked(userQueryPairs.loadDistinctQueryPairs).mockResolvedValue([{ role: 'staff engineer', country: 'us' }]);
    vi.mocked(settingsDb.getSecretSetting).mockImplementation(async (key: string) => {
      if (key === 'adzuna_app_id') return 'db-id';
      if (key === 'adzuna_app_key') return 'db-key';
      return null;
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await adzunaAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/us/search/1?app_id=db-id&app_key=db-key&what=staff%20engineer'),
      expect.anything(),
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { adzunaAdapter } from './adzuna.ts';

describe('adzunaAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
    delete process.env.ADZUNA_COUNTRIES;
    delete process.env.ADZUNA_QUERIES;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await adzunaAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an Adzuna response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.ADZUNA_APP_ID = 'app-id';
    process.env.ADZUNA_APP_KEY = 'app-key';
    process.env.ADZUNA_COUNTRIES = 'us';
    process.env.ADZUNA_QUERIES = 'staff engineer';
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
});

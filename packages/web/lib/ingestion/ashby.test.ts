import { afterEach, describe, expect, it, vi } from 'vitest';
import { ashbyAdapter } from './ashby.ts';
import * as settingsDb from '../settings-db.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

describe('ashbyAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    delete process.env.ASHBY_COMPANIES;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await ashbyAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an Ashby job-board response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.ASHBY_COMPANIES = 'acme:Acme Corp';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            title: 'Data Engineer',
            jobUrl: 'https://example.com/jobs/ashby-1',
            location: 'Austin, TX, United States',
            isRemote: false,
            employmentType: 'FullTime',
            publishedAt: '2026-09-04T00:00:00Z',
            descriptionPlain: 'Full job description text.',
          },
          { title: 'Missing url' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await ashbyAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Data Engineer',
        company: 'Acme Corp',
        locations: ['Austin, TX, United States'],
        country: 'United States',
        workplace: null,
        employment: 'full-time',
        description: 'Full job description text.',
        postedAt: new Date('2026-09-04T00:00:00Z'),
        url: 'https://example.com/jobs/ashby-1',
        source: 'ashby',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.ashbyhq.com/posting-api/job-board/acme',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('prefers a DB-stored company list over the env var', async () => {
    process.env.ASHBY_COMPANIES = 'env-token:Env Co';
    vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
      key === 'ashby_companies' ? 'db-token:DB Co' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await ashbyAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.ashbyhq.com/posting-api/job-board/db-token',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

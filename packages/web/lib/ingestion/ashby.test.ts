import { afterEach, describe, expect, it, vi } from 'vitest';
import { ashbyAdapter } from './ashby.ts';

describe('ashbyAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        postedAt: new Date('2026-09-04T00:00:00Z'),
        url: 'https://example.com/jobs/ashby-1',
        source: 'ashby',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.ashbyhq.com/posting-api/job-board/acme');
  });
});

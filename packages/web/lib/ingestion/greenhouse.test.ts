import { afterEach, describe, expect, it, vi } from 'vitest';
import { greenhouseAdapter } from './greenhouse.ts';

describe('greenhouseAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GREENHOUSE_COMPANIES;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await greenhouseAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a Greenhouse jobs response into RawPosting rows, dropping jobs missing required fields', async () => {
    process.env.GREENHOUSE_COMPANIES = 'acme:Acme Corp';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            title: 'Platform Engineer',
            absolute_url: 'https://example.com/jobs/greenhouse-1',
            updated_at: '2026-09-03T00:00:00Z',
            location: { name: 'Remote, United States' },
          },
          { title: 'Missing url' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await greenhouseAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Platform Engineer',
        company: 'Acme Corp',
        locations: ['Remote, United States'],
        country: 'United States',
        workplace: 'remote',
        employment: null,
        postedAt: new Date('2026-09-03T00:00:00Z'),
        url: 'https://example.com/jobs/greenhouse-1',
        source: 'greenhouse',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true');
  });
});

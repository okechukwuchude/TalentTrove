import { afterEach, describe, expect, it, vi } from 'vitest';
import { greenhouseAdapter } from './greenhouse.ts';
import * as settingsDb from '../settings-db.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

describe('greenhouseAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
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
            content: 'Full job description text.',
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
        description: 'Full job description text.',
        postedAt: new Date('2026-09-03T00:00:00Z'),
        url: 'https://example.com/jobs/greenhouse-1',
        source: 'greenhouse',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('leaves locations/country/workplace unset for a job with no location, rather than throwing', async () => {
    process.env.GREENHOUSE_COMPANIES = 'acme:Acme Corp';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [{ title: 'Remote-Friendly Role', absolute_url: 'https://example.com/jobs/greenhouse-2' }],
        }),
      }),
    );

    const rows = await greenhouseAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Remote-Friendly Role',
        company: 'Acme Corp',
        locations: undefined,
        country: null,
        workplace: null,
        employment: null,
        description: null,
        postedAt: null,
        url: 'https://example.com/jobs/greenhouse-2',
        source: 'greenhouse',
      },
    ]);
  });

  it('strips a "- Remote" suffix from the country segment instead of storing it as the country', async () => {
    process.env.GREENHOUSE_COMPANIES = 'acme:Acme Corp';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [
            {
              title: 'Support Engineer',
              absolute_url: 'https://example.com/jobs/greenhouse-3',
              location: { name: 'United States - Remote' },
            },
          ],
        }),
      }),
    );

    const [row] = await greenhouseAdapter.fetchPostings();

    expect(row!.country).toBe('United States');
    expect(row!.workplace).toBe('remote');
  });

  it('prefers a DB-stored company list over the env var', async () => {
    process.env.GREENHOUSE_COMPANIES = 'env-token:Env Co';
    vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
      key === 'greenhouse_companies' ? 'db-token:DB Co' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await greenhouseAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/db-token/jobs?content=true',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

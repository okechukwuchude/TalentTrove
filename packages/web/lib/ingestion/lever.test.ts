import { afterEach, describe, expect, it, vi } from 'vitest';
import { leverAdapter } from './lever.ts';
import * as settingsDb from '../settings-db.ts';

vi.mock('../settings-db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

describe('leverAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(settingsDb.getSetting).mockReset().mockResolvedValue(null);
    delete process.env.LEVER_COMPANIES;
  });

  it('returns nothing and never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await leverAdapter.fetchPostings()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a Lever postings response into RawPosting rows, dropping postings missing required fields', async () => {
    process.env.LEVER_COMPANIES = 'acme:Acme Corp';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          text: 'Senior Frontend Engineer',
          hostedUrl: 'https://example.com/jobs/lever-1',
          createdAt: 1757030400000,
          workplaceType: 'hybrid',
          categories: { location: 'New York, NY, United States', commitment: 'Full-time' },
          descriptionPlain: 'Full job description text.',
        },
        { text: 'Missing url' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await leverAdapter.fetchPostings();

    expect(rows).toEqual([
      {
        title: 'Senior Frontend Engineer',
        company: 'Acme Corp',
        locations: ['New York, NY, United States'],
        country: 'United States',
        workplace: 'hybrid',
        employment: 'full-time',
        description: 'Full job description text.',
        postedAt: new Date(1757030400000),
        url: 'https://example.com/jobs/lever-1',
        source: 'lever',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.lever.co/v0/postings/acme?mode=json',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('prefers a DB-stored company list over the env var', async () => {
    process.env.LEVER_COMPANIES = 'env-token:Env Co';
    vi.mocked(settingsDb.getSetting).mockImplementation(async (key: string) =>
      key === 'lever_companies' ? 'db-token:DB Co' : null,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    await leverAdapter.fetchPostings();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.lever.co/v0/postings/db-token?mode=json',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

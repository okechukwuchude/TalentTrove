import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsearchAdapter } from './jsearch.ts';

describe('jsearchAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.JSEARCH_API_KEY;
    delete process.env.JSEARCH_QUERIES;
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
        country: 'US',
        workplace: 'remote',
        employment: 'full-time',
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
});

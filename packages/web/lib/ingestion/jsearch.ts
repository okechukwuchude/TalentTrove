import type { IngestionAdapter, RawPosting } from './types.ts';

const JSEARCH_ENDPOINT = 'https://jsearch.p.rapidapi.com/search';

type JSearchJob = {
  job_title?: string;
  employer_name?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_employment_type?: string;
  job_posted_at_datetime_utc?: string;
  job_apply_link?: string;
};

function mapEmployment(raw: string | undefined): RawPosting['employment'] {
  switch (raw) {
    case 'FULLTIME':
      return 'full-time';
    case 'PARTTIME':
      return 'part-time';
    case 'CONTRACTOR':
      return 'contract';
    case 'INTERN':
      return 'internship';
    default:
      return null;
  }
}

function mapJob(job: JSearchJob): RawPosting | null {
  if (!job.job_title || !job.employer_name || !job.job_apply_link) return null;
  const locationParts = [job.job_city, job.job_state, job.job_country].filter((part): part is string => Boolean(part));
  return {
    title: job.job_title,
    company: job.employer_name,
    locations: locationParts.length > 0 ? [locationParts.join(', ')] : undefined,
    country: job.job_country ?? null,
    workplace: job.job_is_remote === true ? 'remote' : null,
    employment: mapEmployment(job.job_employment_type),
    postedAt: job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc) : null,
    url: job.job_apply_link,
    source: 'jsearch',
  };
}

async function fetchPostings(): Promise<RawPosting[]> {
  const apiKey = process.env.JSEARCH_API_KEY;
  const queries = process.env.JSEARCH_QUERIES?.split(',').map((query) => query.trim()).filter(Boolean) ?? [];
  if (!apiKey || queries.length === 0) return [];

  const results: RawPosting[] = [];
  for (const query of queries) {
    const url = `${JSEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&num_pages=1`;
    const response = await fetch(url, {
      headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
    });
    if (!response.ok) continue;
    const body = (await response.json()) as { data?: JSearchJob[] };
    for (const job of body.data ?? []) {
      const mapped = mapJob(job);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}

export const jsearchAdapter: IngestionAdapter = { name: 'jsearch', fetchPostings };

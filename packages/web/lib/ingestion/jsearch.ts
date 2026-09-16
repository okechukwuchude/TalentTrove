import type { IngestionAdapter, RawPosting } from './types.ts';
import { normalizeCountry } from './shared.ts';
import { getSecretSetting, getSetting } from '../settings-db.ts';

// RapidAPI's JSearch retired the original `/search` endpoint (it now 404s
// with "Endpoint '/search' does not exist") in favor of `/search-v2` —
// confirmed by hand against the live API. The job fields themselves
// (job_title, employer_name, etc.) are unchanged, but the envelope changed
// from `{ data: JSearchJob[] }` to `{ data: { jobs: JSearchJob[] } }`.
const JSEARCH_ENDPOINT = 'https://jsearch.p.rapidapi.com/search-v2';

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
  job_description?: string;
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
    country: normalizeCountry(job.job_country),
    workplace: job.job_is_remote === true ? 'remote' : null,
    employment: mapEmployment(job.job_employment_type),
    description: job.job_description ?? null,
    postedAt: job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc) : null,
    url: job.job_apply_link,
    source: 'jsearch',
  };
}

async function fetchPostings(): Promise<RawPosting[]> {
  const apiKey = (await getSecretSetting('jsearch_api_key')) ?? process.env.JSEARCH_API_KEY;
  const queriesRaw = (await getSetting('jsearch_queries')) ?? process.env.JSEARCH_QUERIES;
  const country = (await getSetting('jsearch_country')) ?? process.env.JSEARCH_COUNTRY;
  const queries = queriesRaw?.split(',').map((query) => query.trim()).filter(Boolean) ?? [];
  if (!apiKey || queries.length === 0) return [];

  const results: RawPosting[] = [];
  for (const query of queries) {
    const countryParam = country ? `&country=${encodeURIComponent(country)}` : '';
    const url = `${JSEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&num_pages=1${countryParam}`;
    const response = await fetch(url, {
      headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`jsearch: query "${query}" failed with ${response.status}`);
      continue;
    }
    const body = (await response.json()) as { data?: { jobs?: JSearchJob[] } };
    for (const job of body.data?.jobs ?? []) {
      const mapped = mapJob(job);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}

export const jsearchAdapter: IngestionAdapter = { name: 'jsearch', fetchPostings };

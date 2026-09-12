import type { IngestionAdapter, RawPosting } from './types.ts';
import { countryFromLocation, parseCompanyList } from './shared.ts';

type GreenhouseJob = {
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  location?: { name?: string };
};

function mapJob(job: GreenhouseJob, company: string): RawPosting | null {
  if (!job.title || !job.absolute_url) return null;
  const location = job.location?.name;
  return {
    title: job.title,
    company,
    locations: location ? [location] : undefined,
    country: countryFromLocation(location),
    workplace: location?.toLowerCase().includes('remote') ? 'remote' : null,
    employment: null, // Greenhouse's public jobs endpoint has no standard employment-type field to map
    postedAt: job.updated_at ? new Date(job.updated_at) : null,
    url: job.absolute_url,
    source: 'greenhouse',
  };
}

async function fetchPostings(): Promise<RawPosting[]> {
  const companies = parseCompanyList(process.env.GREENHOUSE_COMPANIES);
  if (companies.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { token, displayName } of companies) {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
    if (!response.ok) continue;
    const body = (await response.json()) as { jobs?: GreenhouseJob[] };
    for (const job of body.jobs ?? []) {
      const mapped = mapJob(job, displayName);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}

export const greenhouseAdapter: IngestionAdapter = { name: 'greenhouse', fetchPostings };

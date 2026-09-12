import type { IngestionAdapter, RawPosting } from './types.ts';

const ADZUNA_ENDPOINT = 'https://api.adzuna.com/v1/api/jobs';

const COUNTRY_NAMES: Record<string, string> = {
  us: 'United States',
  gb: 'United Kingdom',
  ca: 'Canada',
  au: 'Australia',
  de: 'Germany',
  fr: 'France',
};

type AdzunaJob = {
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  contract_time?: string;
  contract_type?: string;
  created?: string;
  redirect_url?: string;
};

function mapEmployment(contractTime: string | undefined, contractType: string | undefined): RawPosting['employment'] {
  if (contractTime === 'full_time') return 'full-time';
  if (contractTime === 'part_time') return 'part-time';
  if (contractType === 'contract') return 'contract';
  return null;
}

function mapJob(job: AdzunaJob, countryCode: string): RawPosting | null {
  const title = job.title;
  const company = job.company?.display_name;
  const url = job.redirect_url;
  if (!title || !company || !url) return null;
  const location = job.location?.display_name;
  return {
    title,
    company,
    locations: location ? [location] : undefined,
    country: COUNTRY_NAMES[countryCode] ?? countryCode,
    workplace: location?.toLowerCase().includes('remote') || title.toLowerCase().includes('remote') ? 'remote' : null,
    employment: mapEmployment(job.contract_time, job.contract_type),
    postedAt: job.created ? new Date(job.created) : null,
    url,
    source: 'adzuna',
  };
}

async function fetchPostings(): Promise<RawPosting[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const countries = process.env.ADZUNA_COUNTRIES?.split(',').map((code) => code.trim().toLowerCase()).filter(Boolean) ?? [];
  const queries = process.env.ADZUNA_QUERIES?.split(',').map((query) => query.trim()).filter(Boolean) ?? [];
  if (!appId || !appKey || countries.length === 0 || queries.length === 0) return [];

  const results: RawPosting[] = [];
  for (const country of countries) {
    for (const query of queries) {
      const url = `${ADZUNA_ENDPOINT}/${country}/search/1?app_id=${appId}&app_key=${appKey}&what=${encodeURIComponent(query)}&content-type=application/json`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const body = (await response.json()) as { results?: AdzunaJob[] };
      for (const job of body.results ?? []) {
        const mapped = mapJob(job, country);
        if (mapped) results.push(mapped);
      }
    }
  }
  return results;
}

export const adzunaAdapter: IngestionAdapter = { name: 'adzuna', fetchPostings };

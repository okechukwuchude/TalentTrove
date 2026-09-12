import type { IngestionAdapter, RawPosting } from './types.ts';
import { countryFromLocation, parseCompanyList } from './shared.ts';

type LeverPosting = {
  text?: string;
  hostedUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; commitment?: string };
};

function mapWorkplace(raw: string | undefined): RawPosting['workplace'] {
  if (raw === 'remote') return 'remote';
  if (raw === 'hybrid') return 'hybrid';
  if (raw === 'on-site') return 'onsite';
  return null;
}

function mapEmployment(raw: string | undefined): RawPosting['employment'] {
  const commitment = raw?.toLowerCase() ?? '';
  if (commitment.includes('full')) return 'full-time';
  if (commitment.includes('part')) return 'part-time';
  if (commitment.includes('intern')) return 'internship';
  if (commitment.includes('contract')) return 'contract';
  return null;
}

function mapJob(job: LeverPosting, company: string): RawPosting | null {
  if (!job.text || !job.hostedUrl) return null;
  const location = job.categories?.location;
  return {
    title: job.text,
    company,
    locations: location ? [location] : undefined,
    country: countryFromLocation(location),
    workplace: mapWorkplace(job.workplaceType),
    employment: mapEmployment(job.categories?.commitment),
    postedAt: job.createdAt ? new Date(job.createdAt) : null,
    url: job.hostedUrl,
    source: 'lever',
  };
}

async function fetchPostings(): Promise<RawPosting[]> {
  const companies = parseCompanyList(process.env.LEVER_COMPANIES);
  if (companies.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { token, displayName } of companies) {
    const response = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`);
    if (!response.ok) continue;
    const body = (await response.json()) as LeverPosting[];
    for (const job of body) {
      const mapped = mapJob(job, displayName);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}

export const leverAdapter: IngestionAdapter = { name: 'lever', fetchPostings };

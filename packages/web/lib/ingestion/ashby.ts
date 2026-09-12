import type { IngestionAdapter, RawPosting } from './types.ts';
import { countryFromLocation, parseCompanyList } from './shared.ts';

type AshbyJob = {
  title?: string;
  jobUrl?: string;
  location?: string;
  isRemote?: boolean;
  employmentType?: string;
  publishedAt?: string;
};

function mapEmployment(raw: string | undefined): RawPosting['employment'] {
  switch (raw) {
    case 'FullTime':
      return 'full-time';
    case 'PartTime':
      return 'part-time';
    case 'Contract':
      return 'contract';
    case 'Intern':
      return 'internship';
    default:
      return null;
  }
}

function mapJob(job: AshbyJob, company: string): RawPosting | null {
  if (!job.title || !job.jobUrl) return null;
  return {
    title: job.title,
    company,
    locations: job.location ? [job.location] : undefined,
    country: countryFromLocation(job.location),
    workplace: job.isRemote === true ? 'remote' : null,
    employment: mapEmployment(job.employmentType),
    postedAt: job.publishedAt ? new Date(job.publishedAt) : null,
    url: job.jobUrl,
    source: 'ashby',
  };
}

async function fetchPostings(): Promise<RawPosting[]> {
  const companies = parseCompanyList(process.env.ASHBY_COMPANIES);
  if (companies.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { token, displayName } of companies) {
    const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
    if (!response.ok) continue;
    const body = (await response.json()) as { jobs?: AshbyJob[] };
    for (const job of body.jobs ?? []) {
      const mapped = mapJob(job, displayName);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}

export const ashbyAdapter: IngestionAdapter = { name: 'ashby', fetchPostings };

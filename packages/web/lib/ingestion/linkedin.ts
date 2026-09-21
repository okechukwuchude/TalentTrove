import type { Employment, IngestionAdapter, RawPosting, Workplace } from './types.ts';
import { normalizeCountry } from './shared.ts';
import { getSecretSetting } from '../settings-db.ts';
import { loadDistinctQueryPairs } from './user-query-pairs.ts';

const LINKEDIN_ENDPOINT = 'https://linkedin-job-search-api.p.rapidapi.com/active-jb';
const LINKEDIN_HOST = 'linkedin-job-search-api.p.rapidapi.com';

// This pipeline runs ingestion once a day (see vercel.json); a 24h window
// keeps each run looking at postings since the last one without re-fetching
// several days of the same listings every time.
const TIME_FRAME = '24h';
const RESULTS_PER_PAIR = 25;

type LinkedinJob = {
  title?: string;
  organization?: string;
  url?: string;
  locations_derived?: string[];
  countries_derived?: string[];
  employment_type?: string[];
  ai_work_arrangement?: string;
  date_posted?: string;
  ai_core_responsibilities?: string;
  ai_requirements_summary?: string;
};

function mapEmployment(raw: string | undefined): Employment | null {
  switch (raw) {
    case 'FULL_TIME':
      return 'full-time';
    case 'PART_TIME':
      return 'part-time';
    case 'CONTRACTOR':
      return 'contract';
    case 'INTERN':
    case 'INTERNSHIP':
      return 'internship';
    default:
      return null;
  }
}

const WORKPLACES: ReadonlySet<string> = new Set(['remote', 'hybrid', 'onsite']);

function mapWorkplace(raw: string | undefined): Workplace | null {
  const lower = raw?.toLowerCase();
  return lower && WORKPLACES.has(lower) ? (lower as Workplace) : null;
}

// This API has no raw job-description field — only these two AI-generated
// summaries. Concatenating them is the closest substitute available; judging
// against a LinkedIn posting therefore sees thinner text than a JSearch or
// Adzuna one, which do carry a full description.
function buildDescription(job: LinkedinJob): string | null {
  const parts = [job.ai_core_responsibilities, job.ai_requirements_summary].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function mapJob(job: LinkedinJob): RawPosting | null {
  const title = job.title;
  const company = job.organization;
  const url = job.url;
  if (!title || !company || !url) return null;
  return {
    title,
    company,
    locations: job.locations_derived && job.locations_derived.length > 0 ? job.locations_derived : undefined,
    country: normalizeCountry(job.countries_derived?.[0]),
    workplace: mapWorkplace(job.ai_work_arrangement),
    employment: mapEmployment(job.employment_type?.[0]),
    description: buildDescription(job),
    postedAt: job.date_posted ? new Date(job.date_posted) : null,
    url,
    source: 'linkedin',
  };
}

async function fetchPostings(): Promise<RawPosting[]> {
  const apiKey = (await getSecretSetting('linkedin_api_key')) ?? process.env.LINKEDIN_API_KEY;
  if (!apiKey) return [];
  const pairs = await loadDistinctQueryPairs();
  if (pairs.length === 0) return [];

  const results: RawPosting[] = [];
  for (const { role, country } of pairs) {
    const location = normalizeCountry(country) ?? country;
    const url = `${LINKEDIN_ENDPOINT}?time_frame=${TIME_FRAME}&limit=${RESULTS_PER_PAIR}&title=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}`;
    const response = await fetch(url, {
      headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': LINKEDIN_HOST },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`linkedin: ${country}/"${role}" failed with ${response.status}`);
      continue;
    }
    const jobs = (await response.json()) as LinkedinJob[];
    for (const job of jobs) {
      const mapped = mapJob(job);
      if (mapped) results.push(mapped);
    }
  }
  return results;
}

export const linkedinAdapter: IngestionAdapter = { name: 'linkedin', fetchPostings };

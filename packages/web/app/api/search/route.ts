import { requireSession } from '../../../lib/require-session.ts';
import { searchPostings } from '../../../lib/postings-search.ts';

type SearchBody = {
  q?: unknown;
  country?: unknown;
  workplace?: unknown;
  employment?: unknown;
  posted_after?: unknown;
  company?: unknown;
  unjudged?: unknown;
  limit?: unknown;
  cursor?: unknown;
};

function parseLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return 20;
  return Math.min(value, 100);
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const body = (await request.json().catch(() => null)) as SearchBody | null;

  // `unjudged` is accepted for wire-compatibility with the existing SearchFilters
  // UI but has no effect yet: there is no judgments table until judge ships, so
  // every posting is "unjudged" by definition today. See
  // docs/superpowers/specs/2026-09-12-postings-search-design.md.
  const filters = {
    q: typeof body?.q === 'string' ? body.q : undefined,
    country: typeof body?.country === 'string' ? body.country : undefined,
    workplace: typeof body?.workplace === 'string' ? body.workplace : undefined,
    employment: typeof body?.employment === 'string' ? body.employment : undefined,
    postedAfter: typeof body?.posted_after === 'string' ? body.posted_after : undefined,
    company: typeof body?.company === 'string' ? body.company.split(',').filter(Boolean) : undefined,
  };

  const limit = parseLimit(body?.limit);
  const cursor = typeof body?.cursor === 'string' ? body.cursor : null;

  const result = await searchPostings(filters, limit, cursor);
  return Response.json({ rows: result.rows, cursor: result.cursor });
}

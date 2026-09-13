import { requireSession } from '../../../lib/require-session.ts';
import { searchCompanies } from '../../../lib/postings-search.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const rows = await searchCompanies(q);
  return Response.json({ rows });
}

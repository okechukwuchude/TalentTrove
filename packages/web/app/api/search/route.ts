import { requireSession } from '../../../lib/require-session.ts';

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'job postings and search are not built yet' }, { status: 501 });
}

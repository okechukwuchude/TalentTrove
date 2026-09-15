import { getApplicationQueue } from '../../../../lib/applications-db.ts';
import { requireSession } from '../../../../lib/require-session.ts';

function parseLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return 20;
  return Math.min(value, 100);
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = url.searchParams.get('cursor');

  const page = await getApplicationQueue(auth.user.userId, limit, cursor);
  return Response.json({ rows: page.rows, cursor: page.cursor });
}

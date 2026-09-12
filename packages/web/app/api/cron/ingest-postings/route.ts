import { timingSafeEqual } from 'node:crypto';
import { runIngestion } from '../../../../lib/ingestion/run-ingestion.ts';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rows = await runIngestion();
  return Response.json({ rows });
}

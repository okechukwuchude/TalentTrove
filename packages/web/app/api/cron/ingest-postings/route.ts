import { timingSafeEqual } from 'node:crypto';
import { runIngestion } from '../../../../lib/ingestion/run-ingestion.ts';

// Five adapters run sequentially, each making one HTTP request per
// configured query/company; a modest source list can take a while.
// Without this, the route inherits the platform's default function
// duration, which a long-enough source list could exceed mid-run, killing
// the function before it ever returns a summary.
export const maxDuration = 300;

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

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rows = await runIngestion();
  // The HTTP response is 200 regardless — the request to run ingestion
  // genuinely succeeded, and per-adapter failure is already carried in the
  // summary body. But Vercel's cron dashboard only shows this route's own
  // status code, not its body, so a run where every source failed would
  // otherwise look identical to a healthy one from that dashboard alone.
  // Logging here at least puts it in the function's own logs.
  if (rows.length > 0 && rows.every((row) => row.failed !== null)) {
    console.error('ingest-postings: every configured adapter failed', rows);
  }
  return Response.json({ rows });
}

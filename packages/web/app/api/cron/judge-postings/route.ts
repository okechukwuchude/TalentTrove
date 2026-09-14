import { timingSafeEqual } from 'node:crypto';
import { runJudging } from '../../../../lib/judging/run-judging.ts';

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

  const rows = await runJudging();
  if (rows.length > 0 && rows.every((row) => row.judged === 0 && row.failed > 0)) {
    console.error('judge-postings: every user\'s batch failed entirely', rows);
  }
  return Response.json({ rows });
}

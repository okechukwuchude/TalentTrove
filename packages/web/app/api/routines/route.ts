import { createRoutine, findRoutineByName, listRoutines } from '../../../lib/routines-db.ts';
import { requireSession } from '../../../lib/require-session.ts';
import type { RoutineFilters } from '../../../lib/postings-search.ts';

type RoutineBody = {
  name?: unknown;
  q?: unknown;
  country?: unknown;
  workplace?: unknown;
  employment?: unknown;
  posted_after?: unknown;
  company?: unknown;
  judge_prompt?: unknown;
  destination_tab?: unknown;
};

function parseFilters(body: RoutineBody): RoutineFilters {
  return {
    q: typeof body.q === 'string' ? body.q : undefined,
    country: typeof body.country === 'string' ? body.country : undefined,
    workplace: typeof body.workplace === 'string' ? body.workplace : undefined,
    employment: typeof body.employment === 'string' ? body.employment : undefined,
    postedAfter: typeof body.posted_after === 'string' ? body.posted_after : undefined,
    company: typeof body.company === 'string' ? body.company.split(',').filter(Boolean) : undefined,
  };
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const rows = await listRoutines(auth.user.userId);
  return Response.json({ rows });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const body = (await request.json().catch(() => null)) as RoutineBody | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return Response.json({ error: 'a routine needs a name' }, { status: 400 });
  }

  if (await findRoutineByName(auth.user.userId, name)) {
    return Response.json({ error: `a routine named "${name}" already exists` }, { status: 400 });
  }

  const filters = parseFilters(body ?? {});
  const judgePrompt = typeof body?.judge_prompt === 'string' && body.judge_prompt.trim() ? body.judge_prompt : null;
  const destinationTab =
    typeof body?.destination_tab === 'string' && body.destination_tab.trim() ? body.destination_tab.trim() : null;

  const routine = await createRoutine(auth.user.userId, name, filters, judgePrompt, destinationTab);
  return Response.json({ rows: [routine] });
}

import { deleteRoutine, findRoutineByName, updateRoutine } from '../../../../lib/routines-db.ts';
import { requireSession } from '../../../../lib/require-session.ts';
import type { RoutineFilters } from '../../../../lib/postings-search.ts';

type RoutineParams = { params: Promise<{ name: string }> };

type RoutineBody = {
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

export async function PUT(request: Request, { params }: RoutineParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  const existing = await findRoutineByName(auth.user.userId, name);
  if (!existing) {
    return Response.json({ error: `no routine named "${name}"` }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as RoutineBody | null;
  const filters = parseFilters(body ?? {});
  const judgePrompt = typeof body?.judge_prompt === 'string' && body.judge_prompt.trim() ? body.judge_prompt : null;
  const destinationTab =
    typeof body?.destination_tab === 'string' && body.destination_tab.trim() ? body.destination_tab.trim() : null;

  const updated = await updateRoutine(auth.user.userId, name, { filters, judgePrompt, destinationTab });
  return Response.json(updated);
}

export async function DELETE(request: Request, { params }: RoutineParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  const existing = await findRoutineByName(auth.user.userId, name);
  if (!existing) {
    return Response.json({ error: `no routine named "${name}"` }, { status: 404 });
  }

  await deleteRoutine(auth.user.userId, name);
  return Response.json({ deleted: true });
}

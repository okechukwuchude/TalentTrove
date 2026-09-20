import { coverageOf } from '@talenttrove/shared';
import { addPostingsToTab, findTabByName } from '../../../../../lib/tabs-db.ts';
import { requireSession } from '../../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  const tab = await findTabByName(auth.user.userId, name);
  if (!tab) {
    return Response.json({ error: `no tab named "${name}"` }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
  if (ids.length === 0) {
    return Response.json({ error: 'the request must include at least one id' }, { status: 400 });
  }

  const result = await addPostingsToTab(auth.user.userId, tab.id, ids);
  return Response.json({
    rows: result!.rows,
    already_present: result!.alreadyPresent,
    unknown: result!.unknown,
    coverage: coverageOf(result!.covered, ids.length),
  });
}

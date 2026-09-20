import { coverageOf } from '@talenttrove/shared';
import { findTabByName, removeFromTab } from '../../../../../lib/tabs-db.ts';
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

  const body = (await request.json().catch(() => null)) as { item_ids?: unknown } | null;
  const itemIds = Array.isArray(body?.item_ids)
    ? body.item_ids.filter((id): id is string => typeof id === 'string')
    : [];
  if (itemIds.length === 0) {
    return Response.json({ error: 'the request must include at least one item_id' }, { status: 400 });
  }

  const result = await removeFromTab(auth.user.userId, tab.id, itemIds);
  return Response.json({
    rows: result!.rows,
    not_found: result!.notFound,
    coverage: coverageOf(result!.covered, itemIds.length),
  });
}

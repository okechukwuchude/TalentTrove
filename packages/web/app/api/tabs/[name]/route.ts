import { deleteTab, findTabByName, getTabContents } from '../../../../lib/tabs-db.ts';
import { requireSession } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

function parseLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return 20;
  return Math.min(value, 100);
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  const tab = await findTabByName(auth.user.userId, name);
  if (!tab) {
    return Response.json({ error: `no tab named "${name}"` }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = url.searchParams.get('cursor');

  const page = await getTabContents(auth.user.userId, tab.id, limit, cursor);
  return Response.json({
    rows: page!.rows,
    cursor: page!.cursor,
    no_longer_present: page!.noLongerPresent.map((entry) => ({ posting_id: entry.postingId, item_id: entry.itemId })),
  });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  const tab = await findTabByName(auth.user.userId, name);
  if (!tab) {
    return Response.json({ error: `no tab named "${name}"` }, { status: 404 });
  }

  await deleteTab(auth.user.userId, tab.id);
  return Response.json({ deleted: true });
}

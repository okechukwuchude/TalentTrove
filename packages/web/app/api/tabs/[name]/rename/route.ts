import { findTabByName, renameTab } from '../../../../../lib/tabs-db.ts';
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

  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  const to = typeof body?.to === 'string' ? body.to.trim() : '';
  if (!to) {
    return Response.json({ error: 'a tab needs a name' }, { status: 400 });
  }
  if (await findTabByName(auth.user.userId, to)) {
    return Response.json({ error: `a tab named "${to}" already exists` }, { status: 400 });
  }

  await renameTab(auth.user.userId, tab.id, to);
  return Response.json({ renamed: true });
}

import { createTab, findTabByName, listTabs } from '../../../lib/tabs-db.ts';
import { requireSession } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const rows = await listTabs(auth.user.userId);
  return Response.json({ rows });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return Response.json({ error: 'a tab needs a name' }, { status: 400 });
  }
  const description = typeof body?.description === 'string' ? body.description : null;

  if (await findTabByName(auth.user.userId, name)) {
    return Response.json({ error: `a tab named "${name}" already exists` }, { status: 400 });
  }

  const tab = await createTab(auth.user.userId, name, description);
  return Response.json({ rows: [tab] });
}

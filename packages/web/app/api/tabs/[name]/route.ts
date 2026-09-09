import { requireSession } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(request: Request, _params: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'tabs are not built yet' }, { status: 501 });
}

export async function DELETE(request: Request, _params: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'tabs are not built yet' }, { status: 501 });
}

import { requireSession } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'profile storage is not built yet' }, { status: 501 });
}

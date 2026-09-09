import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const q = new URL(request.url).searchParams.get('q') ?? '';

  try {
    const query = new URLSearchParams();
    if (q.trim() !== '') query.set('q', q.trim());
    query.set('limit', '10');
    const { json, renewedPass } = await callAsAccount(auth.pass, `/companies?${query.toString()}`);
    const rows = (json as { rows?: unknown } | undefined)?.rows;
    return withRenewedCookie(auth.session, Response.json({ rows: Array.isArray(rows) ? rows : [] }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not look up employers';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

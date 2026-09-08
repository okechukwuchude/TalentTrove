import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, '/profile');
    const rows = (json as { rows?: unknown } | undefined)?.rows ?? [];
    return withRenewedCookie(auth.session, Response.json({ rows }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not load your profile';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

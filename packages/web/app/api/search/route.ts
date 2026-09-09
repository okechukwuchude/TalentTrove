import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, '/search', { method: 'POST', body });
    const asRecord = json as { rows?: unknown; cursor?: unknown; next_cursor?: unknown } | undefined;
    const rows = Array.isArray(asRecord?.rows) ? asRecord.rows : [];
    const cursor = asRecord?.cursor ?? asRecord?.next_cursor ?? null;
    return withRenewedCookie(auth.session, Response.json({ rows, cursor }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not search';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

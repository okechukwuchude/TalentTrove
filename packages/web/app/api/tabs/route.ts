import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, '/tab');
    const rows = (json as { rows?: unknown } | undefined)?.rows;
    return withRenewedCookie(auth.session, Response.json({ rows: Array.isArray(rows) ? rows : [] }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not load your tabs';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown } | null;
  if (typeof body?.name !== 'string' || body.name.trim() === '') {
    return Response.json({ error: 'the request must include a tab name' }, { status: 400 });
  }

  try {
    const upstreamBody: Record<string, unknown> = { name: body.name };
    if (typeof body.description === 'string' && body.description !== '') {
      upstreamBody['description'] = body.description;
    }
    const { json, renewedPass } = await callAsAccount(auth.pass, '/tab', { method: 'POST', body: upstreamBody });
    const rows = (json as { rows?: unknown } | undefined)?.rows;
    return withRenewedCookie(auth.session, Response.json({ rows: Array.isArray(rows) ? rows : [] }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not create the tab';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

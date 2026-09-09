import { PinloopServerError, callAsAccount } from '../../../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;
  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  if (typeof body?.to !== 'string' || body.to.trim() === '') {
    return Response.json({ error: 'the request must include the new name' }, { status: 400 });
  }

  try {
    const { renewedPass } = await callAsAccount(auth.pass, `/tab/${encodeURIComponent(name)}/rename`, {
      method: 'POST',
      body: { to: body.to },
    });
    return withRenewedCookie(auth.session, Response.json({ renamed: true }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not rename the '${name}' tab`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

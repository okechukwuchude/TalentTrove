import { PinloopServerError, callAsAccount } from '../../../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  if (!Array.isArray(body?.ids) || body.ids.length === 0) {
    return Response.json({ error: 'the request must include at least one posting id' }, { status: 400 });
  }

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, `/tab/${encodeURIComponent(name)}/add`, {
      method: 'POST',
      body: { ids: body.ids },
    });
    const asRecord = json as
      | { rows?: unknown; already_present?: unknown; unknown?: unknown; coverage?: unknown }
      | undefined;
    return withRenewedCookie(
      auth.session,
      Response.json({
        rows: Array.isArray(asRecord?.rows) ? asRecord.rows : [],
        already_present: Array.isArray(asRecord?.already_present) ? asRecord.already_present : [],
        unknown: Array.isArray(asRecord?.unknown) ? asRecord.unknown : [],
        coverage: asRecord?.coverage,
      }),
      renewedPass,
    );
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not add to the '${name}' tab`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

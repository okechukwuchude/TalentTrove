import { PinloopServerError, callAsAccount } from '../../../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;
  const body = (await request.json().catch(() => null)) as { item_ids?: unknown } | null;
  if (!Array.isArray(body?.item_ids) || body.item_ids.length === 0) {
    return Response.json({ error: 'the request must include at least one item id' }, { status: 400 });
  }

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, `/tab/${encodeURIComponent(name)}/remove`, {
      method: 'POST',
      body: { item_ids: body.item_ids },
    });
    const asRecord = json as { rows?: unknown; not_found?: unknown; coverage?: unknown } | undefined;
    return withRenewedCookie(
      auth.session,
      Response.json({
        rows: Array.isArray(asRecord?.rows) ? asRecord.rows : [],
        not_found: Array.isArray(asRecord?.not_found) ? asRecord.not_found : [],
        coverage: asRecord?.coverage,
      }),
      renewedPass,
    );
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not remove from the '${name}' tab`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

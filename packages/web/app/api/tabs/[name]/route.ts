import { PinloopServerError, callAsAccount } from '../../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;
  const url = new URL(request.url);
  const query = new URLSearchParams();
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');
  if (limit) query.set('limit', limit);
  if (cursor) query.set('cursor', cursor);

  try {
    const { json, renewedPass } = await callAsAccount(
      auth.pass,
      `/tab/${encodeURIComponent(name)}?${query.toString()}`,
    );
    const asRecord = json as
      | { rows?: unknown; cursor?: unknown; next_cursor?: unknown; no_longer_present?: unknown; coverage?: unknown }
      | undefined;
    const rows = Array.isArray(asRecord?.rows) ? asRecord.rows : [];
    const cursor2 = asRecord?.cursor ?? asRecord?.next_cursor ?? null;
    const noLongerPresent = Array.isArray(asRecord?.no_longer_present) ? asRecord.no_longer_present : [];
    return withRenewedCookie(
      auth.session,
      Response.json({ rows, cursor: cursor2, no_longer_present: noLongerPresent, coverage: asRecord?.coverage }),
      renewedPass,
    );
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not load the '${name}' tab`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  try {
    const { renewedPass } = await callAsAccount(auth.pass, `/tab/${encodeURIComponent(name)}`, { method: 'DELETE' });
    return withRenewedCookie(auth.session, Response.json({ deleted: true }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not delete the '${name}' tab`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

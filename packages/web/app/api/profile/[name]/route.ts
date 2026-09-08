import { PinloopServerError, callAsAccount } from '../../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  try {
    const { json, renewedPass } = await callAsAccount(
      auth.pass,
      `/profile/${encodeURIComponent(name)}?include=text`,
    );
    return withRenewedCookie(auth.session, Response.json(json as Record<string, unknown>), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not load '${name}'`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;
  const contentType = request.headers.get('content-type') ?? '';

  try {
    let result: Awaited<ReturnType<typeof callAsAccount>>;
    if (contentType.includes('application/pdf')) {
      const filename = new URL(request.url).searchParams.get('filename') ?? 'resume.pdf';
      const bytes = new Uint8Array(await request.arrayBuffer());
      result = await callAsAccount(
        auth.pass,
        `/profile/${encodeURIComponent(name)}?filename=${encodeURIComponent(filename)}`,
        { method: 'POST', bytes, contentType: 'application/pdf' },
      );
    } else {
      const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
      const text = typeof body?.text === 'string' ? body.text : '';
      result = await callAsAccount(auth.pass, `/profile/${encodeURIComponent(name)}`, {
        method: 'POST',
        body: { text },
      });
    }
    const response = Response.json((result.json ?? {}) as Record<string, unknown>);
    return withRenewedCookie(auth.session, response, result.renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : `could not store '${name}'`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  try {
    const { renewedPass } = await callAsAccount(auth.pass, `/profile/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    return withRenewedCookie(auth.session, Response.json({ deleted: true }), renewedPass);
  } catch (error) {
    // Deleting a document that was never stored is treated as already done —
    // mirrors removeDocument() in pinloop.ts today.
    if (error instanceof PinloopServerError && error.status === 404) {
      return Response.json({ deleted: true });
    }
    const message = error instanceof PinloopServerError ? error.message : `could not delete '${name}'`;
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

import { FILE_CAP } from '@pinloop/shared';
import { PinloopServerError, callAsAccount } from '../../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

function firstRow(json: unknown): Record<string, unknown> {
  const asRecord = json as { rows?: unknown; results?: unknown } | undefined;
  const rows = asRecord?.rows ?? asRecord?.results;
  return Array.isArray(rows) && rows.length > 0 ? (rows[0] as Record<string, unknown>) : {};
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  try {
    const { json, renewedPass } = await callAsAccount(
      auth.pass,
      `/profile/${encodeURIComponent(name)}?include=text`,
    );
    return withRenewedCookie(auth.session, Response.json(firstRow(json)), renewedPass);
  } catch (error) {
    // A name with no built-in default (background, constraints, preferences) 404s
    // when this account has never stored one, rather than handing back an empty row
    // the way judge-prompt/quick-judge-prompt do. Treat it the same as an unset
    // default here — an empty, editable document — so a first-time visitor gets a
    // blank box to type into instead of a raw "no document named ... is stored" alert.
    if (error instanceof PinloopServerError && error.status === 404) {
      return Response.json({ text: '', stored: false });
    }
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
      const contentLength = Number(request.headers.get('content-length') ?? '');
      if (Number.isFinite(contentLength) && contentLength > FILE_CAP) {
        return Response.json({ error: 'that file is over the 10MB limit' }, { status: 413 });
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > FILE_CAP) {
        return Response.json({ error: 'that file is over the 10MB limit' }, { status: 413 });
      }
      result = await callAsAccount(
        auth.pass,
        `/profile/${encodeURIComponent(name)}?filename=${encodeURIComponent(filename)}`,
        { method: 'POST', bytes, contentType: 'application/pdf' },
      );
    } else {
      const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof body?.text !== 'string') {
        return Response.json({ error: 'the request must include a text field to store' }, { status: 400 });
      }
      const text = body.text;
      result = await callAsAccount(auth.pass, `/profile/${encodeURIComponent(name)}`, {
        method: 'POST',
        body: { text },
      });
    }
    const response = Response.json(firstRow(result.json));
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

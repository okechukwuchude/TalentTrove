import { markApplied, unmarkApplied } from '../../../../lib/applications-db.ts';
import { requireSession } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ postingId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { postingId } = await params;

  if (!isUuid(postingId)) {
    return Response.json({ error: 'invalid posting id' }, { status: 400 });
  }

  await markApplied(auth.user.userId, postingId);
  return Response.json({ applied: true });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { postingId } = await params;

  if (!isUuid(postingId)) {
    return Response.json({ error: 'invalid posting id' }, { status: 400 });
  }

  await unmarkApplied(auth.user.userId, postingId);
  return Response.json({ applied: false });
}

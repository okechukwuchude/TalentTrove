import {
  DEFAULT_JUDGE_PROMPT,
  DEFAULT_QUICK_JUDGE_PROMPT,
  JUDGE_PROMPT_NAME,
  QUICK_JUDGE_PROMPT_NAME,
  wrongKindRefusal,
} from '@pinloop/shared';
import { getProfileDocument } from '../../../../lib/profile-db.ts';
import { requireSession } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  const row = await getProfileDocument(auth.user.userId, name);
  if (row) {
    if (row.kind === 'file') {
      return Response.json({ error: wrongKindRefusal(name) }, { status: 400 });
    }
    return Response.json({ text: row.textContent ?? '', stored: true });
  }

  if (name === JUDGE_PROMPT_NAME) return Response.json({ text: DEFAULT_JUDGE_PROMPT, stored: false });
  if (name === QUICK_JUDGE_PROMPT_NAME) return Response.json({ text: DEFAULT_QUICK_JUDGE_PROMPT, stored: false });
  return Response.json({ text: '', stored: false });
}

export async function POST(request: Request, _params: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'profile storage is not built yet' }, { status: 501 });
}

export async function DELETE(request: Request, _params: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  return Response.json({ error: 'profile storage is not built yet' }, { status: 501 });
}

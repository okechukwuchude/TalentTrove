import {
  DEFAULT_JUDGE_PROMPT,
  DEFAULT_QUICK_JUDGE_PROMPT,
  FILE_CAP,
  JUDGE_PROMPT_NAME,
  NAME_RULE,
  PER_DOCUMENT_CAP,
  QUICK_JUDGE_PROMPT_NAME,
  WHOLE_PROFILE_CAP,
  beginsLikeAPdf,
  holdsTextRefusal,
  nameRuleRefusal,
  notAPdfRefusal,
  overFileCapRefusal,
  perDocumentRefusal,
  reservedKind,
  willNotOpenRefusal,
  wholeProfileRefusal,
  wrongKindRefusal,
} from '@pinloop/shared';
import { parseResumePdf } from '../../../../lib/pdf.ts';
import {
  deleteProfileDocument,
  getProfileDocument,
  sumOtherTextBytes,
  upsertFileDocument,
  upsertTextDocument,
} from '../../../../lib/profile-db.ts';
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

function kindFor(name: string): 'text' | 'file' {
  return reservedKind(name) ?? 'text';
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  if (!reservedKind(name) && !NAME_RULE.test(name)) {
    return Response.json({ error: nameRuleRefusal(name) }, { status: 400 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  const isFileUpload = contentType.includes('application/pdf');
  const expectedKind = kindFor(name);

  if (isFileUpload && expectedKind !== 'file') {
    return Response.json({ error: holdsTextRefusal(name) }, { status: 400 });
  }
  if (!isFileUpload && expectedKind === 'file') {
    return Response.json({ error: wrongKindRefusal(name) }, { status: 400 });
  }

  if (isFileUpload) {
    const filename = new URL(request.url).searchParams.get('filename') ?? 'resume.pdf';
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > FILE_CAP) {
      return Response.json({ error: overFileCapRefusal(bytes.length) }, { status: 413 });
    }
    if (!beginsLikeAPdf(bytes)) {
      return Response.json({ error: notAPdfRefusal() }, { status: 400 });
    }
    let parsed: Awaited<ReturnType<typeof parseResumePdf>>;
    try {
      parsed = await parseResumePdf(bytes);
    } catch (error) {
      return Response.json({ error: willNotOpenRefusal(String(error)) }, { status: 400 });
    }
    const row = await upsertFileDocument(auth.user.userId, name, bytes, filename);
    return Response.json({
      name: row.name,
      kind: row.kind,
      bytes: row.bytes,
      updated_at: row.updatedAt.toISOString(),
      original_filename: row.originalFilename,
      pages: parsed.pages,
      pages_read: parsed.pagesRead,
      characters: parsed.characters,
      ...(parsed.note ? { note: parsed.note } : {}),
    });
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== 'string') {
    return Response.json({ error: 'the request must include a text field to store' }, { status: 400 });
  }
  const text = body.text;
  const size = Buffer.byteLength(text, 'utf8');
  if (size > PER_DOCUMENT_CAP) {
    return Response.json({ error: perDocumentRefusal(size) }, { status: 413 });
  }
  const otherBytes = await sumOtherTextBytes(auth.user.userId, name);
  const wouldBe = otherBytes + size;
  if (wouldBe > WHOLE_PROFILE_CAP) {
    return Response.json({ error: wholeProfileRefusal(wouldBe) }, { status: 413 });
  }
  await upsertTextDocument(auth.user.userId, name, text);
  return Response.json({ text, stored: true });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { name } = await params;

  await deleteProfileDocument(auth.user.userId, name);
  return Response.json({ deleted: true });
}

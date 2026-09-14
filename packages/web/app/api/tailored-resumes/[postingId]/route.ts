import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../lib/db.ts';
import { tailoredResumes } from '../../../../db/schema.ts';
import { requireSession } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ postingId: string }> };

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { postingId } = await params;

  const [row] = await getDb()
    .select({ pdfBytes: tailoredResumes.pdfBytes })
    .from(tailoredResumes)
    .where(and(eq(tailoredResumes.userId, auth.user.userId), eq(tailoredResumes.postingId, postingId)));

  if (!row) {
    return Response.json({ error: 'no tailored resume for this posting' }, { status: 404 });
  }

  return new Response(new Uint8Array(row.pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="resume.pdf"',
    },
  });
}

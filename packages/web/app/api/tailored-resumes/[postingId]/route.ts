import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../lib/db.ts';
import { tailoredResumes } from '../../../../db/schema.ts';
import { requireSession } from '../../../../lib/require-session.ts';

type RouteParams = { params: Promise<{ postingId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `tailored_resumes.posting_id` is a Postgres `uuid` column — comparing it to
 * an arbitrary path segment (a stale/forged/garbage `postingId`) makes
 * Postgres throw "invalid input syntax for type uuid" rather than return no
 * rows, which would surface here as a 500 instead of the 404 this route is
 * supposed to return for anything not found. See `lib/tabs-db.ts`'s
 * `isUuid` for the same guard applied to the same problem elsewhere.
 */
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const { postingId } = await params;
  if (!isUuid(postingId)) {
    return Response.json({ error: 'no tailored resume for this posting' }, { status: 404 });
  }

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

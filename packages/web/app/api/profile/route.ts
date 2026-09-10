import { listProfileDocuments } from '../../../lib/profile-db.ts';
import { requireSession } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const rows = await listProfileDocuments(auth.user.userId);
  return Response.json({
    rows: rows.map((row) => ({
      name: row.name,
      kind: row.kind,
      bytes: row.bytes,
      updated_at: row.updatedAt.toISOString(),
      ...(row.originalFilename ? { original_filename: row.originalFilename } : {}),
    })),
  });
}

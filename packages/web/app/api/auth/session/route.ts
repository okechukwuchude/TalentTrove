import { readSession } from '../../../../lib/session.ts';

export async function GET(request: Request): Promise<Response> {
  const session = await readSession(request.headers.get('cookie'));
  if (!session.accessToken) return Response.json({ signedIn: false });
  return Response.json({ signedIn: true, email: session.email ?? null });
}

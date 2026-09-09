import { deleteSession } from '../../../../lib/auth-db.ts';
import { clearedSessionCookieHeader, readSession } from '../../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  const session = await readSession(request.headers.get('cookie'));
  if (session.token) await deleteSession(session.token);

  const response = Response.json({ signedIn: false });
  response.headers.append('Set-Cookie', clearedSessionCookieHeader());
  return response;
}

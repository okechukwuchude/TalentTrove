import { readCurrentUser } from '../../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const user = await readCurrentUser(request.headers.get('cookie'));
  if (!user) return Response.json({ signedIn: false });
  return Response.json({ signedIn: true, email: user.email });
}

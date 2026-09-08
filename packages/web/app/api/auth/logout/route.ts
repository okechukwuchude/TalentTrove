import { clearedSessionCookieHeader } from '../../../../lib/session.ts';

export async function POST(): Promise<Response> {
  const response = Response.json({ signedIn: false });
  response.headers.append('Set-Cookie', clearedSessionCookieHeader());
  return response;
}

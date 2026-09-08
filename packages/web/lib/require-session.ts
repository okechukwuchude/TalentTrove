import type { Pass } from './pinloop-server.ts';
import { type SessionData, readSession, sealSession, sessionCookieHeader } from './session.ts';

export type SessionResult = { pass: Pass; session: SessionData } | { unauthorized: Response };

export async function requireSession(request: Request): Promise<SessionResult> {
  const session = await readSession(request.headers.get('cookie'));
  if (!session.accessToken) {
    return { unauthorized: Response.json({ error: 'not signed in' }, { status: 401 }) };
  }
  return {
    pass: { accessToken: session.accessToken, refreshToken: session.refreshToken },
    session,
  };
}

export async function withRenewedCookie(
  originalSession: SessionData,
  response: Response,
  renewedPass: Pass | undefined,
): Promise<Response> {
  if (!renewedPass) return response;
  const sealed = await sealSession({
    ...originalSession,
    accessToken: renewedPass.accessToken,
    refreshToken: renewedPass.refreshToken,
  });
  response.headers.append('Set-Cookie', sessionCookieHeader(sealed));
  return response;
}

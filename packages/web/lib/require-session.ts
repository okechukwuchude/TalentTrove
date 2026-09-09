import { resolveSessionToken } from './auth-db.ts';
import { readSession } from './session.ts';

export type CurrentUser = { userId: string; email: string };

export async function readCurrentUser(cookieHeader: string | null): Promise<CurrentUser | null> {
  const session = await readSession(cookieHeader);
  if (!session.token) return null;
  return resolveSessionToken(session.token);
}

export type SessionResult = { user: CurrentUser } | { unauthorized: Response };

export async function requireSession(request: Request): Promise<SessionResult> {
  const user = await readCurrentUser(request.headers.get('cookie'));
  if (!user) return { unauthorized: Response.json({ error: 'not signed in' }, { status: 401 }) };
  return { user };
}

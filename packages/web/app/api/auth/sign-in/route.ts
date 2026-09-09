import { createSession, findUserByEmail, recordFailedSignIn, resetFailedAttempts } from '../../../../lib/auth-db.ts';
import { verifyPassword } from '../../../../lib/passwords.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const GENERIC_ERROR = 'that email or password is wrong';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const user = await findUserByEmail(email);
  if (!user) {
    return Response.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return Response.json(
      { error: `too many attempts — try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}` },
      { status: 429 },
    );
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    await recordFailedSignIn(user.id);
    return Response.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  await resetFailedAttempts(user.id);
  const token = await createSession(user.id);
  const sealed = await sealSession({ token });

  const response = Response.json({ email: user.email });
  response.headers.append('Set-Cookie', sessionCookieHeader(sealed));
  return response;
}

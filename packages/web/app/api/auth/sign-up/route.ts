import { createSession, createUser, findUserByEmail } from '../../../../lib/auth-db.ts';
import { isValidEmail, passwordError } from '../../../../lib/auth-validation.ts';
import { hashPassword } from '../../../../lib/passwords.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!isValidEmail(email)) {
    return Response.json({ error: 'enter a valid email address' }, { status: 400 });
  }
  const passwordProblem = passwordError(password);
  if (passwordProblem) {
    return Response.json({ error: passwordProblem }, { status: 400 });
  }

  if (await findUserByEmail(email)) {
    return Response.json({ error: 'an account with that email already exists' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash);
  const token = await createSession(user.id);
  const sealed = await sealSession({ token });

  const response = Response.json({ email: user.email });
  response.headers.append('Set-Cookie', sessionCookieHeader(sealed));
  return response;
}

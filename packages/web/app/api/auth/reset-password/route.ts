import {
  consumePasswordResetToken,
  deleteAllSessionsForUser,
  updatePasswordHash,
} from '../../../../lib/auth-db.ts';
import { passwordError } from '../../../../lib/auth-validation.ts';
import { hashPassword } from '../../../../lib/passwords.ts';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { token?: unknown; newPassword?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  const passwordProblem = passwordError(newPassword);
  if (passwordProblem) {
    return Response.json({ error: passwordProblem }, { status: 400 });
  }

  const consumed = await consumePasswordResetToken(token);
  if (!consumed) {
    return Response.json({ error: 'that reset link is invalid or has expired' }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await updatePasswordHash(consumed.userId, passwordHash);
  await deleteAllSessionsForUser(consumed.userId);

  return Response.json({ ok: true });
}

import { createPasswordResetToken, findUserByEmail } from '../../../../lib/auth-db.ts';
import { sendPasswordResetEmail } from '../../../../lib/email.ts';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  const user = await findUserByEmail(email);
  if (user) {
    const token = await createPasswordResetToken(user.id);
    const origin = new URL(request.url).origin;
    await sendPasswordResetEmail(user.email, `${origin}/reset-password?token=${token}`);
  }

  return Response.json({ ok: true });
}

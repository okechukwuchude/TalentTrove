import { createPasswordResetToken, findUserByEmail } from '../../../../lib/auth-db.ts';
import { sendPasswordResetEmail } from '../../../../lib/email.ts';

// `request.url` in Next.js App Router is reconstructed from the incoming
// Host/X-Forwarded-Host header, which an attacker can spoof. Emailing a
// reset link built from that would let an attacker point a real user's
// reset link at an attacker-controlled domain (link-poisoning ->
// account takeover). APP_ORIGIN is the trusted source of truth for the
// link's origin; it's required in production and only falls back to the
// request-derived origin for local/dev convenience.
function resetLinkOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_ORIGIN must be set in production to build a safe password-reset link');
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  const user = await findUserByEmail(email);
  if (user) {
    const token = await createPasswordResetToken(user.id);
    const origin = resetLinkOrigin(request);
    await sendPasswordResetEmail(user.email, `${origin}/reset-password?token=${token}`);
  }

  return Response.json({ ok: true });
}

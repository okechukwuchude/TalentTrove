import { Resend } from 'resend';

function resendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY must be set to send email');
  return new Resend(apiKey);
}

export async function sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
  const resend = resendClient();
  const from = process.env.PASSWORD_RESET_FROM_EMAIL ?? 'onboarding@resend.dev';
  await resend.emails.send({
    from,
    to: email,
    subject: 'Reset your password',
    text: `Reset your password by opening this link:\n\n${resetLink}\n\nIf you didn't ask for this, you can ignore this email.`,
  });
}

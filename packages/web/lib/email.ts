import { Resend } from 'resend';

function resendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY must be set to send email');
  return new Resend(apiKey);
}

export async function sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
  const resend = resendClient();
  const from = process.env.PASSWORD_RESET_FROM_EMAIL ?? 'onboarding@resend.dev';
  // The Resend SDK never throws for send failures - it resolves
  // { data, error }. Discarding that return value used to make a bad API
  // key, a Resend outage, or a domain-verification failure a silent no-op.
  // We log rather than throw: throwing here would turn a 500 response into
  // an account-enumeration oracle on the request-password-reset endpoint.
  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: 'Reset your password',
    text: `Reset your password by opening this link:\n\n${resetLink}\n\nIf you didn't ask for this, you can ignore this email.`,
  });
  if (error) {
    console.error('sendPasswordResetEmail failed:', error);
  }
}

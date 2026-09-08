'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = { name: 'email' } | { name: 'code'; email: string };

export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSendCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? 'could not send a code');
        return;
      }
      setStep({ name: 'code', email });
    } catch {
      setError('could not reach the server — check your connection and try again');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (step.name !== 'code') return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: step.email, code }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? 'could not verify that code');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('could not reach the server — check your connection and try again');
    } finally {
      setSubmitting(false);
    }
  }

  if (step.name === 'code') {
    return (
      <main>
        <h1>Sign in</h1>
        <p>We sent a code to {step.email}.</p>
        <form onSubmit={handleVerifyCode} noValidate>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={submitting}
          />
          <button type="submit" disabled={submitting || code.trim() === ''}>
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
        <button
          type="button"
          onClick={() => {
            setStep({ name: 'email' });
            setCode('');
            setError(null);
          }}
        >
          Use a different email
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p>Enter your email and we&rsquo;ll send you a code to sign in with.</p>
      <form onSubmit={handleSendCode} noValidate>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
        />
        <button type="submit" disabled={submitting || email.trim() === ''}>
          {submitting ? 'Sending…' : 'Send code'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

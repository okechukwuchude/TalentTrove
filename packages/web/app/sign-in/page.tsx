'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

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
      <main className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">We sent a code to {step.email}.</p>
        <form onSubmit={handleVerifyCode} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={submitting}
            />
          </div>
          <Button type="submit" disabled={submitting || code.trim() === ''}>
            {submitting ? 'Verifying…' : 'Verify'}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setStep({ name: 'email' });
            setCode('');
            setError(null);
          }}
        >
          Use a different email
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-sm text-muted-foreground">
        Enter your email and we&rsquo;ll send you a code to sign in with.
      </p>
      <form onSubmit={handleSendCode} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />
        </div>
        <Button type="submit" disabled={submitting || email.trim() === ''}>
          {submitting ? 'Sending…' : 'Send code'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

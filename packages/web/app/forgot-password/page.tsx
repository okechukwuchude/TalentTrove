'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          If an account exists for that address, we&rsquo;ve sent a reset link.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold">Forgot your password?</h1>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
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
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </main>
  );
}

'use client';

import React, { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

const SIGN_IN_URL = 'https://pinloop.ai/login';

export default function SignInPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch('/api/auth/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = (await response.json()) as { error?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? 'could not sign in');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p>
        <a href={SIGN_IN_URL} target="_blank" rel="noopener noreferrer">
          Open the sign-in page
        </a>{' '}
        in a new tab, sign in with Google, GitHub, or an emailed code, then paste the code it
        shows you below.
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="code">Code</label>
        <input id="code" value={code} onChange={(event) => setCode(event.target.value)} disabled={submitting} />
        <button type="submit" disabled={submitting || code.trim() === ''}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

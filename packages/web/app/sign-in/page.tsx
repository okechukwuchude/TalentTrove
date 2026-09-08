'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SIGN_IN_PAGE_PATH, SIGN_IN_SITE_URL } from '@pinloop/shared';

const SIGN_IN_URL = `${SIGN_IN_SITE_URL}${SIGN_IN_PAGE_PATH}`;

export default function SignInPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? 'could not sign in');
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

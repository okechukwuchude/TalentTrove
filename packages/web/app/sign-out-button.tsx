'use client';

import { useRouter } from 'next/navigation';
import { Button } from '../components/ui/button.tsx';

export function SignOutButton() {
  const router = useRouter();

  async function handleClick(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleClick}>
      Sign out
    </Button>
  );
}

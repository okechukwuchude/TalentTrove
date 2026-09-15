import Link from 'next/link';
import { SignOutButton } from '../app/sign-out-button.tsx';

export function AppNav({ signedIn, email }: { signedIn: boolean; email?: string }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold">
          TalentTrove
        </Link>
        {signedIn ? (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/search" className="hover:underline">
              Search
            </Link>
            <Link href="/tabs" className="hover:underline">
              Tabs
            </Link>
            <Link href="/routines" className="hover:underline">
              Routines
            </Link>
            <Link href="/apply" className="hover:underline">
              Apply
            </Link>
            <Link href="/profile" className="hover:underline">
              Profile
            </Link>
            <Link href="/settings" className="hover:underline">
              Settings
            </Link>
            {email && <span className="text-muted-foreground">{email}</span>}
            <SignOutButton />
          </nav>
        ) : (
          <Link href="/sign-in" className="text-sm hover:underline">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

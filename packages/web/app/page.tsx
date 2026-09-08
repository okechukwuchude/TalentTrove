import Link from 'next/link';
import { cookies } from 'next/headers';
import { readSession } from '../lib/session.ts';
import { SignOutButton } from './sign-out-button.tsx';

export default async function HomePage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);
  const signedIn = Boolean(session.accessToken);

  return (
    <main>
      <h1>TalentTrove</h1>
      {signedIn ? (
        <p>
          Signed in{session.email ? ` as ${session.email}` : ''}. <SignOutButton />
        </p>
      ) : (
        <p>
          <Link href="/sign-in">Sign in</Link> to get started.
        </p>
      )}
      {signedIn && (
        <p>
          <Link href="/profile">Manage your profile</Link>
        </p>
      )}
    </main>
  );
}

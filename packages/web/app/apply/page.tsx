import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readCurrentUser } from '../../lib/require-session.ts';
import { ApplyView } from './apply-view.tsx';

export default async function ApplyPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const user = await readCurrentUser(cookieHeader);
  if (!user) redirect('/sign-in');

  return <ApplyView />;
}

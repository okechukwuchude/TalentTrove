import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readCurrentUser } from '../../lib/require-session.ts';
import { RoutinesView } from './routines-view.tsx';

export default async function RoutinesPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const user = await readCurrentUser(cookieHeader);
  if (!user) redirect('/sign-in');

  return <RoutinesView />;
}

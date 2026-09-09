import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readCurrentUser } from '../../lib/require-session.ts';
import { TabsView } from './tabs-view.tsx';

export default async function TabsPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const user = await readCurrentUser(cookieHeader);
  if (!user) redirect('/sign-in');

  return <TabsView />;
}

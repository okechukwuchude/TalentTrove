import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession } from '../../lib/session.ts';
import { SearchView } from './search-view.tsx';

export default async function SearchPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);
  if (!session.accessToken) redirect('/sign-in');

  return <SearchView />;
}

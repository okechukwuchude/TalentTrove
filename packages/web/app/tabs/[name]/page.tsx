import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession } from '../../../lib/session.ts';
import { TabDetailView } from './tab-detail-view.tsx';

type PageParams = { params: Promise<{ name: string }> };

export default async function TabDetailPage({ params }: PageParams) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);
  if (!session.accessToken) redirect('/sign-in');
  const { name } = await params;

  return <TabDetailView name={name} />;
}

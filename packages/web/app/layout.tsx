import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { QueryProvider } from './query-provider.tsx';
import { readSession } from '../lib/session.ts';
import { AppNav } from '../components/app-nav.tsx';
import './globals.css';

export const metadata = {
  title: 'TalentTrove',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <QueryProvider>
          <AppNav signedIn={Boolean(session.accessToken)} email={session.email} />
          <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>
        </QueryProvider>
      </body>
    </html>
  );
}

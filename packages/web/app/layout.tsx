import type { ReactNode } from 'react';
import { QueryProvider } from './query-provider.tsx';

export const metadata = {
  title: 'TalentTrove',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}

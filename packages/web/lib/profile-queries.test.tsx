// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useProfileDocuments } from './profile-queries.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useProfileDocuments', () => {
  it('fetches the list of stored documents', async () => {
    const rows = [{ name: 'resume', kind: 'file', bytes: 55000 }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ rows }), { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const { result } = renderHook(() => useProfileDocuments(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(rows));
  });
});

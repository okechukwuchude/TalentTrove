// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useApplicationQueue, useMarkApplied, useUnmarkApplied } from './application-queries.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('useApplicationQueue', () => {
  it('fetches the queue and maps rows to Postings carrying cover_letter', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        rows: [
          {
            id: 'p1',
            title: 'Staff Engineer',
            company: 'Acme',
            url: 'https://x/p1',
            verdict: 'strong',
            cover_letter: 'Dear Hiring Manager,',
          },
        ],
        cursor: null,
      }),
    );
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useApplicationQueue(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.pages[0]?.rows).toEqual([
      {
        id: 'p1',
        title: 'Staff Engineer',
        company: 'Acme',
        url: 'https://x/p1',
        posted_at: null,
        verdict: 'strong',
        cover_letter: 'Dear Hiring Manager,',
      },
    ]);
    expect(doFetch).toHaveBeenCalledWith('/api/applications/queue?limit=20');
  });
});

describe('useMarkApplied', () => {
  it('posts to the posting-specific applications route', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ applied: true }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useMarkApplied(), { wrapper });

    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith('/api/applications/p1', expect.objectContaining({ method: 'POST' }));
  });
});

describe('useUnmarkApplied', () => {
  it('deletes to the posting-specific applications route', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ applied: false }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useUnmarkApplied(), { wrapper });

    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith('/api/applications/p1', expect.objectContaining({ method: 'DELETE' }));
  });
});

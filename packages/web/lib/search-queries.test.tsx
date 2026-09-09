// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useCompanies, useSearch } from './search-queries.ts';

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

describe('useSearch', () => {
  it('does not fetch while filters is null', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderHook(() => useSearch(null), { wrapper });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('fetches the first page and maps rows to Postings', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }], cursor: 'c2' }),
    );
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useSearch({ q: 'engineer' }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.pages[0]?.rows).toEqual([
      { id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1', posted_at: null },
    ]);
    expect(result.current.hasNextPage).toBe(true);
    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ limit: '20', q: 'engineer' });
  });

  it('has no next page once the server sends a null cursor', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null }));
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useSearch({}), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('useCompanies', () => {
  it('does not fetch for a query shorter than two characters', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderHook(() => useCompanies('a'), { wrapper });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('fetches matching employers for a query of two or more characters', async () => {
    const rows = [{ id: 'c1', name: 'Acme Inc', posting_count: 12 }];
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows }));
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useCompanies('acme'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(doFetch).toHaveBeenCalledWith('/api/companies?q=acme');
  });
});

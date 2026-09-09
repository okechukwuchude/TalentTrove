// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MAX_AUTO_ADVANCE_PAGES, useCompanies, useSearch } from './search-queries.ts';

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
      jsonResponse({
        rows: [
          {
            id: 'p1',
            title: 'Staff Engineer',
            company: 'Acme',
            url: 'https://x/p1',
            locations: ['Remote'],
            workplace: 'remote',
            employment: 'full-time',
            posted_at: '2026-09-01T00:00:00Z',
            strength: 0.87,
          },
        ],
        cursor: 'c2',
      }),
    );
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useSearch({ q: 'engineer' }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.pages[0]?.rows).toEqual([
      {
        id: 'p1',
        title: 'Staff Engineer',
        company: 'Acme',
        url: 'https://x/p1',
        locations: ['Remote'],
        workplace: 'remote',
        employment: 'full-time',
        posted_at: '2026-09-01T00:00:00Z',
        strength: 0.87,
      },
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

  it('automatically advances past empty pages until rows appear', async () => {
    // The real server can hand back a page with zero rows and a live cursor —
    // "nothing in this batch, but there is more to check" — rather than ever
    // refusing or erroring. A person clicking Search once should not have to
    // notice that and click Load more themselves.
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [], cursor: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ rows: [], cursor: 'c2' }))
      .mockResolvedValueOnce(
        jsonResponse({
          rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }],
          cursor: null,
        }),
      );
    vi.stubGlobal('fetch', doFetch);

    // A stable filters reference, the way SearchView's own state behaves between
    // renders (only a fresh search submission creates a new one) — an inline
    // object literal here would be recreated on every render renderHook triggers,
    // which would reset the hook's own auto-advance counter every time.
    const filters = { q: 'engineer' };
    const { result } = renderHook(() => useSearch(filters), { wrapper });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(3));
    expect(result.current.data?.pages.at(-1)?.rows).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(false);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it('stops auto-advancing at the page cap, leaving a next page for a manual Load more', async () => {
    // A fresh Response per call: a shared instance's body can only be read once,
    // and this hook is expected to call fetch many times in a row.
    const doFetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ rows: [], cursor: 'always-more' })));
    vi.stubGlobal('fetch', doFetch);

    const filters = { q: 'engineer' };
    const { result } = renderHook(() => useSearch(filters), { wrapper });

    await waitFor(() => expect(doFetch).toHaveBeenCalledTimes(MAX_AUTO_ADVANCE_PAGES + 1));
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.isFetchingNextPage).toBe(false);
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

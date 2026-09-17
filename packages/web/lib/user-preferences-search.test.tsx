// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { buildQueryPairs, useUserPreferencesSearch } from './user-preferences-search.ts';

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

function posting(id: string, postedAt: string | null) {
  return { id, title: `Title ${id}`, company: 'Acme', url: `https://x/${id}`, posted_at: postedAt };
}

describe('buildQueryPairs', () => {
  it('is the cross product of roles and countries', () => {
    expect(buildQueryPairs(['a', 'b'], ['us', 'gb'])).toEqual([
      { role: 'a', country: 'us' },
      { role: 'a', country: 'gb' },
      { role: 'b', country: 'us' },
      { role: 'b', country: 'gb' },
    ]);
  });

  it('is empty when either side is empty', () => {
    expect(buildQueryPairs([], ['us'])).toEqual([]);
    expect(buildQueryPairs(['a'], [])).toEqual([]);
  });
});

describe('useUserPreferencesSearch', () => {
  it('fetches nothing and returns no rows when there are no pairs', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useUserPreferencesSearch([], []), { wrapper });

    expect(doFetch).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('queries once per (role, country) pair', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null }));
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useUserPreferencesSearch(['engineer'], ['us', 'gb']), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(doFetch).toHaveBeenCalledWith(
      '/api/search',
      expect.objectContaining({ body: JSON.stringify({ q: 'engineer', country: 'us', limit: 5 }) }),
    );
    expect(doFetch).toHaveBeenCalledWith(
      '/api/search',
      expect.objectContaining({ body: JSON.stringify({ q: 'engineer', country: 'gb', limit: 5 }) }),
    );
  });

  it('merges results across pairs, deduping by posting id and sorting by posted date desc', async () => {
    const doFetch = vi.fn((_input: RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { country: string };
      if (body.country === 'us') {
        return Promise.resolve(
          jsonResponse({ rows: [posting('shared', '2026-09-01T00:00:00Z'), posting('us-only', '2026-09-03T00:00:00Z')] }),
        );
      }
      return Promise.resolve(jsonResponse({ rows: [posting('shared', '2026-09-01T00:00:00Z')] }));
    });
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useUserPreferencesSearch(['engineer'], ['us', 'gb']), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.rows.map((row) => row.id)).toEqual(['us-only', 'shared']);
  });

  it('reports an error if any underlying search fails', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useUserPreferencesSearch(['engineer'], ['us']), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('boom');
  });
});

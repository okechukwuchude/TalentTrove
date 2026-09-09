// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import {
  useAddToTab,
  useCreateTab,
  useDeleteTab,
  useRemoveFromTab,
  useRenameTab,
  useTab,
  useTabs,
} from './tab-queries.ts';

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

describe('useTabs', () => {
  it('fetches the list of tabs', async () => {
    const rows = [{ name: 'shortlist', description: 'roles to apply to', items: 3 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows })));
    const { result } = renderHook(() => useTabs(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(rows));
  });
});

describe('useCreateTab', () => {
  it('posts the name and description', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ name: 'shortlist', items: 0 }] }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useCreateTab(), { wrapper });

    result.current.mutate({ name: 'shortlist', description: 'roles to apply to' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith(
      '/api/tabs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'shortlist', description: 'roles to apply to' }),
      }),
    );
  });
});

describe('useRenameTab', () => {
  it('posts the new name to the tab-specific rename route', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ renamed: true }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useRenameTab('shortlist'), { wrapper });

    result.current.mutate('applied');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith(
      '/api/tabs/shortlist/rename',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'applied' }) }),
    );
  });
});

describe('useDeleteTab', () => {
  it('deletes the named tab', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ deleted: true }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useDeleteTab('shortlist'), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith('/api/tabs/shortlist', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('useTab', () => {
  it('fetches a page of the tab and maps rows to Postings carrying item_id', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1', item_id: 'i1' }],
        cursor: null,
        no_longer_present: [],
      }),
    );
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useTab('shortlist'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.pages[0]?.rows).toEqual([
      {
        id: 'p1',
        title: 'Staff Engineer',
        company: 'Acme',
        url: 'https://x/p1',
        posted_at: null,
        item_id: 'i1',
      },
    ]);
    expect(doFetch).toHaveBeenCalledWith('/api/tabs/shortlist?limit=20');
  });

  it('carries no_longer_present through to the page', async () => {
    const noLongerPresent = [{ posting_id: 'p9', item_id: 'i9' }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null, no_longer_present: noLongerPresent })),
    );
    const { result } = renderHook(() => useTab('shortlist'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.pages[0]?.no_longer_present).toEqual(noLongerPresent);
  });
});

describe('useAddToTab', () => {
  it('posts ids to the named tab chosen at call time', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [], already_present: [], unknown: [] }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useAddToTab(), { wrapper });

    result.current.mutate({ name: 'shortlist', ids: ['p1'] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith(
      '/api/tabs/shortlist/add',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: ['p1'] }) }),
    );
  });
});

describe('useRemoveFromTab', () => {
  it('posts item_ids to the tab-specific remove route', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [], not_found: [] }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useRemoveFromTab('shortlist'), { wrapper });

    result.current.mutate(['i1']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith(
      '/api/tabs/shortlist/remove',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ item_ids: ['i1'] }) }),
    );
  });
});

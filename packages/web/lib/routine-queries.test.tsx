// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useCreateRoutine, useDeleteRoutine, useRoutines, useUpdateRoutine } from './routine-queries.ts';

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

describe('useRoutines', () => {
  it('fetches the list of routines and maps snake_case fields', async () => {
    const rows = [
      {
        name: 'staff-eng',
        filters: { q: 'staff engineer', company: ['Acme', 'Globex'] },
        judge_prompt: 'is this role senior enough?',
        destination_tab: 'shortlist',
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows })));
    const { result } = renderHook(() => useRoutines(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      {
        name: 'staff-eng',
        filters: { q: 'staff engineer', company: ['Acme', 'Globex'] },
        judgePrompt: 'is this role senior enough?',
        destinationTab: 'shortlist',
      },
    ]);
  });

  it('passes filters.company through as the array it arrives as, not a joined string', async () => {
    const rows = [
      {
        name: 'staff-eng',
        filters: { company: ['Acme', 'Globex'] },
        judge_prompt: null,
        destination_tab: null,
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows })));
    const { result } = renderHook(() => useRoutines(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.filters.company).toEqual(['Acme', 'Globex']);
  });

  it('maps missing judge_prompt/destination_tab to null', async () => {
    const rows = [{ name: 'staff-eng', filters: {} }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows })));
    const { result } = renderHook(() => useRoutines(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.judgePrompt).toBeNull();
    expect(result.current.data?.[0]?.destinationTab).toBeNull();
  });
});

describe('useCreateRoutine', () => {
  it('posts the flattened body with company joined as a comma string, and invalidates routines on success', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ name: 'staff-eng', filters: {} }] }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useCreateRoutine(), { wrapper });

    result.current.mutate({
      name: 'staff-eng',
      q: 'staff engineer',
      company: 'Acme,Globex',
      judgePrompt: 'is this senior enough?',
      destinationTab: 'shortlist',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith(
      '/api/routines',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'staff-eng',
          q: 'staff engineer',
          company: 'Acme,Globex',
          judge_prompt: 'is this senior enough?',
          destination_tab: 'shortlist',
        }),
      }),
    );
  });
});

describe('useUpdateRoutine', () => {
  it('puts the flattened body to the name-scoped URL and invalidates routines on success', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ name: 'staff-eng', filters: {} }] }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useUpdateRoutine('staff-eng'), { wrapper });

    result.current.mutate({ q: 'principal engineer' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith(
      '/api/routines/staff-eng',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ q: 'principal engineer' }),
      }),
    );
  });
});

describe('useDeleteRoutine', () => {
  it('deletes the named routine and invalidates routines on success', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ deleted: true }));
    vi.stubGlobal('fetch', doFetch);
    const { result } = renderHook(() => useDeleteRoutine('staff-eng'), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doFetch).toHaveBeenCalledWith('/api/routines/staff-eng', expect.objectContaining({ method: 'DELETE' }));
  });
});

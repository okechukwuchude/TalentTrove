'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { asPosting, type Posting } from './posting.ts';

export type Tab = { name: string; description?: string; items: number };

type TabsResponse = { rows: Record<string, unknown>[] };
export type AddToTabResponse = {
  rows: Record<string, unknown>[];
  already_present: string[];
  unknown: string[];
  coverage?: unknown;
};
type TabDetailResponse = {
  rows: Record<string, unknown>[];
  cursor: string | null;
  no_longer_present: { posting_id: string; item_id: string }[];
};
type TabDetailPage = {
  rows: Posting[];
  cursor: string | null;
  no_longer_present: { posting_id: string; item_id: string }[];
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

function asTab(row: Record<string, unknown>): Tab {
  return {
    name: String(row['name'] ?? ''),
    description: typeof row['description'] === 'string' ? row['description'] : undefined,
    items: typeof row['items'] === 'number' ? row['items'] : 0,
  };
}

export function useTabs() {
  return useQuery({
    queryKey: ['tabs'],
    queryFn: () => fetchJson<TabsResponse>('/api/tabs').then((data) => data.rows.map(asTab)),
  });
}

export function useCreateTab() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      fetchJson('/api/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tabs'] }),
  });
}

export function useRenameTab(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (to: string) =>
      fetchJson(`/api/tabs/${encodeURIComponent(name)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tabs'] }),
  });
}

export function useDeleteTab(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson(`/api/tabs/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tabs'] }),
  });
}

export function useTab(name: string) {
  return useInfiniteQuery({
    queryKey: ['tabs', name],
    queryFn: async ({ pageParam }): Promise<TabDetailPage> => {
      const query = new URLSearchParams({ limit: '20' });
      if (pageParam) query.set('cursor', pageParam as string);
      const data = await fetchJson<TabDetailResponse>(
        `/api/tabs/${encodeURIComponent(name)}?${query.toString()}`,
      );
      return { rows: data.rows.map(asPosting), cursor: data.cursor, no_longer_present: data.no_longer_present };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
  });
}

export function useAddToTab() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, ids }: { name: string; ids: string[] }) =>
      fetchJson<AddToTabResponse>(`/api/tabs/${encodeURIComponent(name)}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tabs'] });
      queryClient.invalidateQueries({ queryKey: ['tabs', variables.name] });
    },
  });
}

export function useRemoveFromTab(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) =>
      fetchJson(`/api/tabs/${encodeURIComponent(name)}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: itemIds }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tabs', name] }),
  });
}

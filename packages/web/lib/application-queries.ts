'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { asPosting, type Posting } from './posting.ts';

type QueueResponse = { rows: Record<string, unknown>[]; cursor: string | null };
type QueuePage = { rows: Posting[]; cursor: string | null };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

export function useApplicationQueue() {
  return useInfiniteQuery({
    queryKey: ['applications', 'queue'],
    queryFn: async ({ pageParam }): Promise<QueuePage> => {
      const query = new URLSearchParams({ limit: '20' });
      if (pageParam) query.set('cursor', pageParam as string);
      const data = await fetchJson<QueueResponse>(`/api/applications/queue?${query.toString()}`);
      return { rows: data.rows.map(asPosting), cursor: data.cursor };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
  });
}

export function useMarkApplied() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postingId: string) => fetchJson(`/api/applications/${postingId}`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications', 'queue'] }),
  });
}

export function useUnmarkApplied() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postingId: string) => fetchJson(`/api/applications/${postingId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications', 'queue'] }),
  });
}

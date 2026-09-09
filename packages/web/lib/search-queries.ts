'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { asPosting, type Posting } from './posting.ts';

export type SearchFilters = {
  q?: string;
  country?: string;
  workplace?: string;
  employment?: string;
  postedAfter?: string;
  company?: string;
  unjudged?: boolean;
};

export type Company = { id: string; name: string; website_domain?: string; posting_count: number };

type SearchResponse = {
  rows: Record<string, unknown>[];
  cursor: string | null;
  interpretation?: Record<string, unknown>;
};
type SearchPage = { rows: Posting[]; cursor: string | null; interpretation?: Record<string, unknown> };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

function searchBody(filters: SearchFilters, cursor: string | undefined): Record<string, string> {
  const body: Record<string, string> = { limit: '20' };
  const q = filters.q?.trim();
  if (q) body['q'] = q;
  if (filters.country) body['country'] = filters.country;
  if (filters.workplace) body['workplace'] = filters.workplace;
  if (filters.employment) body['employment'] = filters.employment;
  if (filters.postedAfter) body['posted_after'] = filters.postedAfter;
  if (filters.company) body['company'] = filters.company;
  if (filters.unjudged) body['unjudged'] = 'true';
  if (cursor) body['cursor'] = cursor;
  return body;
}

export function useSearch(filters: SearchFilters | null) {
  return useInfiniteQuery({
    queryKey: ['search', filters],
    queryFn: async ({ pageParam }): Promise<SearchPage> => {
      const data = await fetchJson<SearchResponse>('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchBody(filters ?? {}, pageParam as string | undefined)),
      });
      return { rows: data.rows.map(asPosting), cursor: data.cursor, interpretation: data.interpretation };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    enabled: filters !== null,
  });
}

export function useCompanies(query: string) {
  return useQuery({
    queryKey: ['companies', query],
    queryFn: () =>
      fetchJson<{ rows: Company[] }>(`/api/companies?q=${encodeURIComponent(query)}`).then((data) => data.rows),
    enabled: query.trim().length >= 2,
  });
}

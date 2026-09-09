'use client';

import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { asPosting, type Posting } from './posting.ts';

/**
 * The real search server can hand back a page with zero rows and a live
 * cursor — "nothing matched in the batch just scanned, but there is more to
 * check" — rather than ever refusing or settling for good. A ranked word
 * search can walk its whole scoring ceiling that way (seen 20, 40, 60... all
 * empty) before a match surfaces. Left alone, the Search tab would show a
 * bare "Load more" button with no results and no explanation, so useSearch
 * keeps fetching on its own while every page so far is empty, up to this many
 * *additional* pages, and hands back control once rows appear or the server
 * runs out of cursor.
 */
export const MAX_AUTO_ADVANCE_PAGES = 8;

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
  const query = useInfiniteQuery({
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

  const advanced = useRef(0);
  useEffect(() => {
    advanced.current = 0;
  }, [filters]);

  useEffect(() => {
    const pages = query.data?.pages ?? [];
    const totalRows = pages.reduce((sum, page) => sum + page.rows.length, 0);
    if (
      pages.length > 0 &&
      totalRows === 0 &&
      query.hasNextPage &&
      !query.isFetchingNextPage &&
      advanced.current < MAX_AUTO_ADVANCE_PAGES
    ) {
      advanced.current += 1;
      query.fetchNextPage();
    }
  }, [query.data, query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  return query;
}

export function useCompanies(query: string) {
  return useQuery({
    queryKey: ['companies', query],
    queryFn: () =>
      fetchJson<{ rows: Company[] }>(`/api/companies?q=${encodeURIComponent(query)}`).then((data) => data.rows),
    enabled: query.trim().length >= 2,
  });
}

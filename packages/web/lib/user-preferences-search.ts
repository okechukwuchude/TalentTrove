import { useQueries } from '@tanstack/react-query';
import { asPosting, type Posting } from './posting.ts';

export type QueryPair = { role: string; country: string };

/**
 * Capped per pair, not paginated — this feeds an automatic preview on
 * /profile, not the full paginated search experience /search already
 * offers. Someone wanting every result for a role/country still has
 * /search.
 */
const RESULTS_PER_PAIR = 5;

async function fetchJson<T>(input: RequestInfo, init: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

export function buildQueryPairs(roles: string[], countries: string[]): QueryPair[] {
  const pairs: QueryPair[] = [];
  for (const role of roles) {
    for (const country of countries) {
      pairs.push({ role, country });
    }
  }
  return pairs;
}

function postedAtMillis(posting: Posting): number {
  return posting.posted_at ? new Date(posting.posted_at).getTime() : -Infinity;
}

export function useUserPreferencesSearch(roles: string[], countries: string[]) {
  const pairs = buildQueryPairs(roles, countries);

  const results = useQueries({
    queries: pairs.map((pair) => ({
      queryKey: ['user-preferences-search', pair.role, pair.country],
      queryFn: async (): Promise<Posting[]> => {
        const data = await fetchJson<{ rows: Record<string, unknown>[] }>('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: pair.role, country: pair.country, limit: RESULTS_PER_PAIR }),
        });
        return data.rows.map(asPosting);
      },
    })),
  });

  const merged = new Map<string, Posting>();
  for (const result of results) {
    for (const posting of result.data ?? []) {
      if (!merged.has(posting.id)) merged.set(posting.id, posting);
    }
  }

  return {
    rows: Array.from(merged.values()).sort((a, b) => postedAtMillis(b) - postedAtMillis(a)),
    isLoading: pairs.length > 0 && results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    error: (results.find((result) => result.isError)?.error as Error | undefined) ?? null,
  };
}

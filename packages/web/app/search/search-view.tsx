'use client';

import { useState } from 'react';
import { useSearch, type SearchFilters as SearchFiltersValue } from '../../lib/search-queries.ts';
import { PostingList } from '../../components/posting-list.tsx';
import { SearchFilters } from './search-filters.tsx';

/**
 * The covered/total portion of the CLI's coverage sentence (`coverageIn`,
 * `packages/shared/src/coverage.ts`), read off whatever `interpretation`
 * object the most recent search page carried. This is deliberately only the
 * "N of M matched" fraction, not the CLI's full semantic-mode/ceiling/
 * unjudged wording — see the spec doc for why that's out of scope here.
 */
function coveragePrefix(interpretation: Record<string, unknown> | undefined): string {
  const covered = interpretation?.['covered'];
  const total = interpretation?.['total'];
  if (typeof covered !== 'number' || typeof total !== 'number') return '';
  return `${covered} of ${total} matched — `;
}

export function SearchView() {
  const [filters, setFilters] = useState<SearchFiltersValue | null>(null);
  const search = useSearch(filters);
  const pages = search.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.rows);
  const interpretation = pages.at(-1)?.interpretation;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Search</h1>
      <SearchFilters onSearch={setFilters} />
      {filters !== null && (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {coveragePrefix(interpretation)}
              {rows.length} posting{rows.length === 1 ? '' : 's'} found so far
            </p>
          )}
          <PostingList
            postings={rows}
            isLoading={search.isLoading}
            isError={search.isError}
            error={search.error}
            hasNextPage={search.hasNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            onLoadMore={() => search.fetchNextPage()}
            emptyMessage="No postings matched that search."
          />
        </>
      )}
    </div>
  );
}

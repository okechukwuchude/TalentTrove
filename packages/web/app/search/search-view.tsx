'use client';

import { useState } from 'react';
import { useSearch, type SearchFilters as SearchFiltersValue } from '../../lib/search-queries.ts';
import { PostingList } from '../../components/posting-list.tsx';
import { SearchFilters } from './search-filters.tsx';

export function SearchView() {
  const [filters, setFilters] = useState<SearchFiltersValue | null>(null);
  const search = useSearch(filters);
  const rows = search.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Search</h1>
      <SearchFilters onSearch={setFilters} />
      {filters !== null && (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-muted-foreground">
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

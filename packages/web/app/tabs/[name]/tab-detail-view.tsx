'use client';

import { useRemoveFromTab, useTab } from '../../../lib/tab-queries.ts';
import { PostingList } from '../../../components/posting-list.tsx';
import { Button } from '../../../components/ui/button.tsx';

export function TabDetailView({ name }: { name: string }) {
  const tab = useTab(name);
  const remove = useRemoveFromTab(name);
  const pages = tab.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.rows);
  const noLongerPresent = pages.flatMap((page) => page.no_longer_present);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{name}</h1>
      {noLongerPresent.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {noLongerPresent.length} posting{noLongerPresent.length === 1 ? '' : 's'} in this tab{' '}
          {noLongerPresent.length === 1 ? 'is' : 'are'} no longer in the corpus.
        </p>
      )}
      <PostingList
        postings={rows}
        isLoading={tab.isLoading}
        isError={tab.isError}
        error={tab.error}
        hasNextPage={tab.hasNextPage}
        isFetchingNextPage={tab.isFetchingNextPage}
        onLoadMore={() => tab.fetchNextPage()}
        emptyMessage="This tab holds no postings that are still in the corpus."
        renderActions={(posting) =>
          posting.item_id ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate([posting.item_id as string])}
            >
              Remove from tab
            </Button>
          ) : null
        }
      />
      {remove.isError && (
        <p role="alert" className="text-sm text-destructive">
          {remove.error.message}
        </p>
      )}
    </div>
  );
}

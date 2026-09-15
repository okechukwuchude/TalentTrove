'use client';

import { useApplicationQueue, useMarkApplied } from '../../lib/application-queries.ts';
import { PostingList } from '../../components/posting-list.tsx';
import { Button } from '../../components/ui/button.tsx';

export function ApplyView() {
  const queue = useApplicationQueue();
  const markApplied = useMarkApplied();
  const rows = (queue.data?.pages ?? []).flatMap((page) => page.rows);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Ready to apply</h1>
      <PostingList
        postings={rows}
        isLoading={queue.isLoading}
        isError={queue.isError}
        error={queue.error}
        hasNextPage={queue.hasNextPage}
        isFetchingNextPage={queue.isFetchingNextPage}
        onLoadMore={() => queue.fetchNextPage()}
        emptyMessage="Nothing ready to apply to yet — postings show up here once judge and tailoring have processed them."
        renderActions={(posting) => {
          const isThisPosting = markApplied.variables === posting.id;
          const isPending = markApplied.isPending && isThisPosting;
          return (
            <div className="flex flex-col items-end gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => markApplied.mutate(posting.id)}
              >
                {isPending ? 'Marking…' : 'Mark as applied'}
              </Button>
              {markApplied.isError && isThisPosting && (
                <p role="alert" className="text-sm text-destructive">
                  Could not mark &quot;{posting.title}&quot; as applied: {markApplied.error.message}
                </p>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

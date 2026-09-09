import type { ReactNode } from 'react';
import { Button } from './ui/button.tsx';
import { PostingCard } from './posting-card.tsx';
import type { Posting } from '../lib/posting.ts';

export function PostingList({
  postings,
  isLoading,
  isError,
  error,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  emptyMessage,
  renderActions,
}: {
  postings: Posting[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage: string;
  renderActions?: (posting: Posting) => ReactNode;
}) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error?.message ?? 'could not load postings'}
      </p>
    );
  }
  if (postings.length === 0 && !hasNextPage) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;

  return (
    <div className="flex flex-col gap-3">
      {postings.map((posting) => (
        <PostingCard key={posting.id} posting={posting} actions={renderActions?.(posting)} />
      ))}
      {hasNextPage && (
        <Button variant="outline" disabled={isFetchingNextPage} onClick={onLoadMore}>
          {isFetchingNextPage ? (postings.length === 0 ? 'Searching…' : 'Loading…') : 'Load more'}
        </Button>
      )}
    </div>
  );
}

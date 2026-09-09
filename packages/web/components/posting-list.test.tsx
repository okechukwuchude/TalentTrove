// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PostingList } from './posting-list.tsx';
import type { Posting } from '../lib/posting.ts';

const postings: Posting[] = [
  { id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://example.com/p1', posted_at: null },
  { id: 'p2', title: 'Senior Engineer', company: 'Beta', url: 'https://example.com/p2', posted_at: null },
];

afterEach(() => {
  cleanup();
});

describe('PostingList', () => {
  it('shows the empty message when there are no postings and nothing is loading', () => {
    render(<PostingList postings={[]} isLoading={false} isError={false} emptyMessage="No postings matched." />);
    expect(screen.getByText('No postings matched.')).toBeInTheDocument();
  });

  it('shows the server error instead of the list', () => {
    render(
      <PostingList
        postings={[]}
        isLoading={false}
        isError
        error={new Error('could not search')}
        emptyMessage="No postings matched."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('could not search');
  });

  it('renders one card per posting, with per-posting actions from renderActions', () => {
    render(
      <PostingList
        postings={postings}
        isLoading={false}
        isError={false}
        emptyMessage="No postings matched."
        renderActions={(posting) => <button>Judge {posting.id}</button>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Staff Engineer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Senior Engineer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Judge p1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Judge p2' })).toBeInTheDocument();
  });

  it('renders Load more (not the empty message) when there are zero postings but hasNextPage is true', () => {
    render(
      <PostingList
        postings={[]}
        isLoading={false}
        isError={false}
        emptyMessage="No postings matched."
        hasNextPage
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
    expect(screen.queryByText('No postings matched.')).not.toBeInTheDocument();
  });

  it('shows "Searching…" instead of "Load more" while auto-advancing past an empty page', () => {
    render(
      <PostingList
        postings={[]}
        isLoading={false}
        isError={false}
        emptyMessage="No postings matched."
        hasNextPage
        isFetchingNextPage
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /searching/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^load more$/i })).not.toBeInTheDocument();
  });

  it('shows a Load more button only when there is a next page, and calls onLoadMore', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <PostingList postings={postings} isLoading={false} isError={false} emptyMessage="none" />,
    );
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();

    rerender(
      <PostingList
        postings={postings}
        isLoading={false}
        isError={false}
        emptyMessage="none"
        hasNextPage
        onLoadMore={onLoadMore}
      />,
    );
    screen.getByRole('button', { name: /load more/i }).click();
    expect(onLoadMore).toHaveBeenCalled();
  });
});

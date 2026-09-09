// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SearchView } from './search-view.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('SearchView', () => {
  it('shows nothing below the form until a search is submitted', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithClient(<SearchView />);
    expect(screen.queryByText(/no postings matched/i)).not.toBeInTheDocument();
  });

  it('runs the search on submit and renders the results', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }], cursor: null }),
    );
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SearchView />);

    fireEvent.change(screen.getByLabelText('Search words'), { target: { value: 'engineer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'Staff Engineer' })).toBeInTheDocument();
    expect(doFetch).toHaveBeenCalledWith('/api/search', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the empty message when the search comes back with no rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null })));
    renderWithClient(<SearchView />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No postings matched that search.')).toBeInTheDocument();
  });

  it('shows the covered/total prefix when the response includes an interpretation', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }],
        cursor: null,
        interpretation: { covered: 3, total: 10 },
      }),
    );
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SearchView />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/3 of 10 matched — 1 posting found so far/)).toBeInTheDocument();
  });

  it('fetches the next page when Load more is clicked', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }], cursor: 'c2' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ rows: [{ id: 'p2', title: 'Senior Engineer', company: 'Beta', url: 'https://x/p2' }], cursor: null }),
      );
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SearchView />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('link', { name: 'Staff Engineer' });
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Senior Engineer' })).toBeInTheDocument());
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});

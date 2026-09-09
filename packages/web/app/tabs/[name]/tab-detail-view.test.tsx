// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TabDetailView } from './tab-detail-view.tsx';

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

describe('TabDetailView', () => {
  it('shows the empty message when the tab holds no postings still in the corpus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null, no_longer_present: [] })));
    renderWithClient(<TabDetailView name="shortlist" />);
    expect(await screen.findByText('This tab holds no postings that are still in the corpus.')).toBeInTheDocument();
  });

  it('renders a Remove from tab action per posting, using its item_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1', item_id: 'i1' }],
          cursor: null,
          no_longer_present: [],
        }),
      ),
    );
    renderWithClient(<TabDetailView name="shortlist" />);
    expect(await screen.findByRole('button', { name: 'Remove from tab' })).toBeInTheDocument();
  });

  it('removes a posting when its Remove from tab button is clicked', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1', item_id: 'i1' }],
          cursor: null,
          no_longer_present: [],
        }),
      )
      .mockResolvedValue(jsonResponse({ rows: [], not_found: [] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<TabDetailView name="shortlist" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove from tab' }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/tabs/shortlist/remove',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ item_ids: ['i1'] }) }),
      ),
    );
  });

  it('shows a banner naming how many postings are no longer in the corpus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ rows: [], cursor: null, no_longer_present: [{ posting_id: 'p9', item_id: 'i9' }] }),
      ),
    );
    renderWithClient(<TabDetailView name="shortlist" />);
    expect(await screen.findByText('1 posting in this tab is no longer in the corpus.')).toBeInTheDocument();
  });
});

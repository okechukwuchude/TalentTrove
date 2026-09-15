// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ApplyView } from './apply-view.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('ApplyView', () => {
  it('shows the empty message when the queue is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null })));
    renderWithClient(<ApplyView />);
    expect(await screen.findByText(/nothing ready to apply/i)).toBeInTheDocument();
  });

  it('renders a card per queue entry, with the cover letter and a mark-as-applied button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          rows: [
            {
              id: 'p1',
              title: 'Staff Engineer',
              company: 'Acme',
              url: 'https://x/p1',
              verdict: 'strong',
              cover_letter: 'Dear Hiring Manager,',
              has_tailored_resume: true,
            },
          ],
          cursor: null,
        }),
      ),
    );
    renderWithClient(<ApplyView />);

    expect(await screen.findByRole('link', { name: 'Staff Engineer' })).toHaveAttribute('href', 'https://x/p1');
    expect(screen.getByText('Cover letter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as applied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download tailored resume' })).toBeInTheDocument();
  });

  it('marking a posting applied removes it from the list', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1', cover_letter: 'letter' }],
          cursor: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ applied: true }))
      .mockResolvedValue(jsonResponse({ rows: [], cursor: null }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<ApplyView />);

    await screen.findByRole('link', { name: 'Staff Engineer' });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as applied' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Staff Engineer' })).not.toBeInTheDocument());
  });
});

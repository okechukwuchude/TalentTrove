// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TabsView } from './tabs-view.tsx';

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

describe('TabsView', () => {
  it('shows the empty message when the account has no tabs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows: [] })));
    renderWithClient(<TabsView />);
    expect(await screen.findByText('This account has no tabs yet.')).toBeInTheDocument();
  });

  it('renders a card per tab, with a link to its detail page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ rows: [{ name: 'shortlist', description: 'roles to apply to', items: 3 }] })),
    );
    renderWithClient(<TabsView />);
    const link = await screen.findByRole('link', { name: 'shortlist' });
    expect(link).toHaveAttribute('href', '/tabs/shortlist');
    expect(screen.getByText('roles to apply to')).toBeInTheDocument();
    expect(screen.getByText('3 postings')).toBeInTheDocument();
  });

  it('creates a new tab from the form', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [] }))
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 0 }] }))
      .mockResolvedValue(jsonResponse({ rows: [{ name: 'shortlist', items: 0 }] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<TabsView />);

    await screen.findByText('This account has no tabs yet.');
    fireEvent.change(screen.getByLabelText('New tab name'), { target: { value: 'shortlist' } });
    fireEvent.click(screen.getByRole('button', { name: /^new tab$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/tabs',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'shortlist', description: undefined }) }),
      ),
    );
  });

  it('renames a tab', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }))
      .mockResolvedValueOnce(jsonResponse({ renamed: true }))
      .mockResolvedValue(jsonResponse({ rows: [{ name: 'applied', items: 3 }] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<TabsView />);

    await screen.findByRole('link', { name: 'shortlist' });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Rename shortlist'), { target: { value: 'applied' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/tabs/shortlist/rename',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'applied' }) }),
      ),
    );
  });

  it('deletes a tab', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<TabsView />);

    await screen.findByRole('link', { name: 'shortlist' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith('/api/tabs/shortlist', expect.objectContaining({ method: 'DELETE' })),
    );
  });
});

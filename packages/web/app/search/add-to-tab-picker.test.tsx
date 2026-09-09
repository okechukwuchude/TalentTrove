// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AddToTabPicker } from './add-to-tab-picker.tsx';

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

describe('AddToTabPicker', () => {
  it('opens a list of existing tabs when clicked, and adds the posting to the one chosen', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }))
      .mockResolvedValue(jsonResponse({ rows: [], already_present: [], unknown: [] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<AddToTabPicker postingId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add to tab' }));
    fireEvent.click(await screen.findByRole('button', { name: 'shortlist' }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/tabs/shortlist/add',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: ['p1'] }) }),
      ),
    );
    expect(await screen.findByText("Added to 'shortlist'")).toBeInTheDocument();
  });

  it('creates a new tab and adds the posting to it', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [] }))
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 0 }] }))
      .mockResolvedValue(jsonResponse({ rows: [], already_present: [], unknown: [] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<AddToTabPicker postingId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add to tab' }));
    fireEvent.change(await screen.findByLabelText('New tab name'), { target: { value: 'shortlist' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/tabs',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'shortlist' }) }),
      ),
    );
    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/tabs/shortlist/add',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: ['p1'] }) }),
      ),
    );
  });
});

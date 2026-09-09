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
      .mockImplementation(async () => jsonResponse({ rows: [{ id: 'p1' }], already_present: [], unknown: [] }));
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
      .mockImplementation(async () => jsonResponse({ rows: [], already_present: [], unknown: [] }));
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

  it('shows "Already in" instead of "Added to" when the posting was already in the tab', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }))
      .mockImplementation(async () => jsonResponse({ rows: [], already_present: ['p1'], unknown: [] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<AddToTabPicker postingId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add to tab' }));
    fireEvent.click(await screen.findByRole('button', { name: 'shortlist' }));

    expect(await screen.findByText("Already in 'shortlist'")).toBeInTheDocument();
    expect(screen.queryByText("Added to 'shortlist'")).not.toBeInTheDocument();
  });

  it('shows the createTab error inside the still-open dropdown rather than hiding it', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'that name is taken' }), { status: 400 }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<AddToTabPicker postingId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add to tab' }));
    fireEvent.change(await screen.findByLabelText('New tab name'), { target: { value: 'shortlist' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('that name is taken');
    expect(screen.getByLabelText('New tab name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shortlist' })).toBeInTheDocument();
  });

  it('closes the dropdown when Escape is pressed', async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<AddToTabPicker postingId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add to tab' }));
    await screen.findByLabelText('New tab name');

    fireEvent.keyDown(screen.getByLabelText('New tab name'), { key: 'Escape' });

    expect(screen.queryByLabelText('New tab name')).not.toBeInTheDocument();
  });

  it('closes the dropdown when clicking outside the picker', async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<AddToTabPicker postingId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add to tab' }));
    await screen.findByLabelText('New tab name');

    fireEvent.mouseDown(document.body);

    expect(screen.queryByLabelText('New tab name')).not.toBeInTheDocument();
  });

  it('marks the trigger as aria-expanded while the dropdown is open', async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'shortlist', items: 3 }] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<AddToTabPicker postingId="p1" />);

    const trigger = screen.getByRole('button', { name: 'Add to tab' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    await screen.findByLabelText('New tab name');

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

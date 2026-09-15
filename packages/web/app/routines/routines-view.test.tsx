// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RoutinesView } from './routines-view.tsx';

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

describe('RoutinesView', () => {
  it('shows a loading state, then a card per routine with its name and filter summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          rows: [
            {
              name: 'staff-eng',
              filters: { q: 'staff engineer', company: ['Acme', 'Globex'] },
              judge_prompt: null,
              destination_tab: null,
            },
          ],
        }),
      ),
    );
    renderWithClient(<RoutinesView />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await screen.findByText('staff-eng');
    expect(screen.getByText('q: staff engineer, company: Acme, Globex')).toBeInTheDocument();
  });

  it('shows the empty message when the account has no routines', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows: [] })));
    renderWithClient(<RoutinesView />);
    expect(await screen.findByText('This account has no routines yet.')).toBeInTheDocument();
  });

  it('creates a new routine from the form, sending a flattened payload', async () => {
    const doFetch = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/companies')) {
        return Promise.resolve(jsonResponse({ rows: [{ id: 'Acme', name: 'Acme' }] }));
      }
      if (url === '/api/routines' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ created: true }));
      }
      return Promise.resolve(jsonResponse({ rows: [] }));
    });
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<RoutinesView />);

    await screen.findByText('This account has no routines yet.');

    fireEvent.change(screen.getByLabelText('New routine name'), { target: { value: 'staff-eng' } });
    fireEvent.change(screen.getByLabelText('Search words'), { target: { value: 'staff engineer' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText('Workplace'), { target: { value: 'remote' } });
    fireEvent.change(screen.getByLabelText('Employment'), { target: { value: 'full-time' } });
    fireEvent.change(screen.getByLabelText('Posted after'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'ac' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Acme' }));
    fireEvent.change(screen.getByLabelText(/judge prompt/i), { target: { value: 'strong signal only' } });
    fireEvent.change(screen.getByLabelText(/file strong\/fair matches/i), { target: { value: 'shortlist' } });

    fireEvent.click(screen.getByRole('button', { name: /^new routine$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/routines',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'staff-eng',
            q: 'staff engineer',
            country: 'US',
            workplace: 'remote',
            employment: 'full-time',
            posted_after: '2024-01-01',
            company: 'Acme',
            judge_prompt: 'strong signal only',
            destination_tab: 'shortlist',
          }),
        }),
      ),
    );
  });

  it('reveals a form pre-filled with the routine\'s existing values when Edit is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          rows: [
            {
              name: 'staff-eng',
              filters: {
                q: 'staff engineer',
                country: 'US',
                workplace: 'remote',
                employment: 'full-time',
                postedAfter: '2024-01-01',
                company: ['Acme', 'Globex'],
              },
              judge_prompt: 'strong signal only',
              destination_tab: 'shortlist',
            },
          ],
        }),
      ),
    );
    renderWithClient(<RoutinesView />);

    await screen.findByText('staff-eng');
    const card = screen.getByRole('button', { name: 'Edit' }).closest('.rounded-lg') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));

    // FilterFields/CompanyCombobox generate their own unique ids internally
    // via React's useId(), so every id on the page is unique even with the
    // create form and an edit form mounted at once. getByLabelText can
    // therefore resolve each field correctly, scoped to the card, with no
    // workaround.
    expect(within(card).getByLabelText('Search words')).toHaveValue('staff engineer');
    expect(within(card).getByLabelText('Country')).toHaveValue('US');
    expect(within(card).getByLabelText('Workplace')).toHaveValue('remote');
    expect(within(card).getByLabelText('Employment')).toHaveValue('full-time');
    expect(within(card).getByLabelText('Posted after')).toHaveValue('2024-01-01');
    expect(within(card).getByText('Acme')).toBeInTheDocument();
    expect(within(card).getByText('Globex')).toBeInTheDocument();
    expect(within(card).getByLabelText('Judge prompt (optional)')).toHaveValue('strong signal only');
    expect(within(card).getByLabelText('File strong/fair matches into tab (optional)')).toHaveValue('shortlist');
  });

  it('deletes a routine', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rows: [{ name: 'staff-eng', filters: {}, judge_prompt: null, destination_tab: null }] }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<RoutinesView />);

    await screen.findByText('staff-eng');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith('/api/routines/staff-eng', expect.objectContaining({ method: 'DELETE' })),
    );
  });
});

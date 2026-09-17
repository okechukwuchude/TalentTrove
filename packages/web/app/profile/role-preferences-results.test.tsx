// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RolePreferencesResults } from './role-preferences-results.tsx';

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

describe('RolePreferencesResults', () => {
  it('renders nothing when no roles or countries are saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ roles: [], countries: [] })));
    const { container } = renderWithClient(<RolePreferencesResults />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows postings matching the saved roles and countries', async () => {
    const doFetch = vi.fn((input: RequestInfo) => {
      if (String(input) === '/api/user-preferences') {
        return Promise.resolve(jsonResponse({ roles: ['staff engineer'], countries: ['us'] }));
      }
      return Promise.resolve(
        jsonResponse({
          rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1', posted_at: null }],
        }),
      );
    });
    vi.stubGlobal('fetch', doFetch);

    renderWithClient(<RolePreferencesResults />);

    expect(await screen.findByText('Staff Engineer')).toBeInTheDocument();
  });

  it('shows the empty message when nothing matches', async () => {
    const doFetch = vi.fn((input: RequestInfo) => {
      if (String(input) === '/api/user-preferences') {
        return Promise.resolve(jsonResponse({ roles: ['staff engineer'], countries: ['us'] }));
      }
      return Promise.resolve(jsonResponse({ rows: [] }));
    });
    vi.stubGlobal('fetch', doFetch);

    renderWithClient(<RolePreferencesResults />);

    expect(await screen.findByText('No postings matched your saved roles and countries yet.')).toBeInTheDocument();
  });
});

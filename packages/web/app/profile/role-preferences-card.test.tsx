// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RolePreferencesCard } from './role-preferences-card.tsx';

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

describe('RolePreferencesCard', () => {
  it('loads and displays stored roles and countries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ roles: ['staff software engineer'], countries: ['us'] })),
    );
    renderWithClient(<RolePreferencesCard />);

    expect(await screen.findByText('staff software engineer')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
  });

  it('adds a role from the input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ roles: [], countries: [] })));
    renderWithClient(<RolePreferencesCard />);

    const input = await screen.findByPlaceholderText('e.g. senior backend engineer');
    fireEvent.change(input, { target: { value: 'backend engineer' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText('backend engineer')).toBeInTheDocument();
    expect(screen.getByText('Roles (1/5)')).toBeInTheDocument();
  });

  it('removes a role when its remove button is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ roles: ['backend engineer'], countries: [] })));
    renderWithClient(<RolePreferencesCard />);

    await screen.findByText('backend engineer');
    fireEvent.click(screen.getByRole('button', { name: 'Remove backend engineer' }));

    await waitFor(() => expect(screen.queryByText('backend engineer')).not.toBeInTheDocument());
  });

  it('disables unselected countries once 3 are picked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ roles: [], countries: ['us', 'gb', 'ca'] })));
    renderWithClient(<RolePreferencesCard />);

    await screen.findByText('Countries (3/3)');
    const unselected = screen.getByText('DE').closest('button') as HTMLButtonElement;
    expect(unselected).toBeDisabled();
  });

  it('saves the edited roles and countries', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ roles: [], countries: [] }))
      .mockImplementation(() => Promise.resolve(jsonResponse({ roles: ['backend engineer'], countries: ['us'] })));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<RolePreferencesCard />);

    const input = await screen.findByPlaceholderText('e.g. senior backend engineer');
    fireEvent.change(input, { target: { value: 'backend engineer' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    fireEvent.click(screen.getByText('US').closest('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/user-preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ roles: ['backend engineer'], countries: ['us'] }),
        }),
      ),
    );
  });
});

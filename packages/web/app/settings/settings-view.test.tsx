// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SettingsView } from './settings-view.tsx';

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

const ITEMS = [
  { key: 'jsearch_api_key', label: 'JSearch API key', secret: true, value: null, isSet: false },
  {
    key: 'greenhouse_companies',
    label: 'Greenhouse companies (token:Display Name, comma-separated)',
    secret: false,
    value: 'stripe:Stripe',
    isSet: true,
  },
  { key: 'adzuna_app_id', label: 'Adzuna app ID', secret: true, value: null, isSet: true },
];

describe('SettingsView', () => {
  it('shows a loading state, then a section per adapter with its fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: ITEMS })));
    renderWithClient(<SettingsView />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await screen.findByText('JSearch');
    expect(screen.getByLabelText('Greenhouse companies (token:Display Name, comma-separated)')).toHaveValue(
      'stripe:Stripe',
    );
    expect(screen.getByText('Adzuna')).toBeInTheDocument();
  });

  it('shows "Not set" / "Currently set" for secret fields without ever showing their value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: ITEMS })));
    renderWithClient(<SettingsView />);

    await screen.findByText('JSearch');
    expect(screen.getByLabelText('JSearch API key')).toHaveValue('');
    expect(screen.getAllByText('Not set')).toHaveLength(1);
    expect(screen.getAllByText('Currently set')).toHaveLength(1);
  });

  it('saves only the fields touched in a section', async () => {
    const doFetch = vi.fn((_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse({ items: ITEMS }));
      return Promise.resolve(jsonResponse({ items: ITEMS }));
    });
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SettingsView />);

    await screen.findByText('Greenhouse');
    fireEvent.change(screen.getByLabelText('Greenhouse companies (token:Display Name, comma-separated)'), {
      target: { value: 'figma:Figma' },
    });
    const greenhouseSection = screen.getByText('Greenhouse').closest('.rounded-lg') as HTMLElement;
    fireEvent.click(within(greenhouseSection).getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ greenhouse_companies: 'figma:Figma' }),
        }),
      ),
    );
  });
});

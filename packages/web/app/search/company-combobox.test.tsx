// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CompanyCombobox } from './company-combobox.tsx';

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

describe('CompanyCombobox', () => {
  it('shows suggestions once two or more characters are typed, and adds one on click', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ id: 'c1', name: 'Acme Inc', posting_count: 12 }] }));
    vi.stubGlobal('fetch', doFetch);
    const onChange = vi.fn();

    renderWithClient(<CompanyCombobox selected={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'ac' } });

    const suggestion = await screen.findByRole('button', { name: 'Acme Inc' });
    fireEvent.click(suggestion);

    expect(onChange).toHaveBeenCalledWith([{ id: 'c1', name: 'Acme Inc' }]);
  });

  it('shows a removable badge for each already-selected company', () => {
    renderWithClient(<CompanyCombobox selected={[{ id: 'c1', name: 'Acme Inc' }]} onChange={vi.fn()} />);
    expect(screen.getByText('Acme Inc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Acme Inc' })).toBeInTheDocument();
  });

  it('removes a company when its badge remove button is clicked', () => {
    const onChange = vi.fn();
    renderWithClient(<CompanyCombobox selected={[{ id: 'c1', name: 'Acme Inc' }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Acme Inc' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

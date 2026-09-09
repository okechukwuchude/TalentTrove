// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SearchFilters } from './search-filters.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('SearchFilters', () => {
  it('calls onSearch with the entered words and selected filters, omitting empty ones', () => {
    const onSearch = vi.fn();
    renderWithClient(<SearchFilters onSearch={onSearch} />);

    fireEvent.change(screen.getByLabelText('Search words'), { target: { value: 'staff engineer' } });
    fireEvent.change(screen.getByLabelText('Workplace'), { target: { value: 'remote' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).toHaveBeenCalledWith({
      q: 'staff engineer',
      country: undefined,
      workplace: 'remote',
      employment: undefined,
      postedAfter: undefined,
      company: undefined,
      unjudged: false,
    });
  });

  it('sets unjudged to true when the checkbox is checked', () => {
    const onSearch = vi.fn();
    renderWithClient(<SearchFilters onSearch={onSearch} />);

    fireEvent.click(screen.getByLabelText(/leave out postings/i));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ unjudged: true }));
  });
});

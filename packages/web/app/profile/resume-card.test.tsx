// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ResumeCard } from './resume-card.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ResumeCard', () => {
  it('rejects a non-PDF file without calling the server', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<ResumeCard />);

    const file = new File(['not a pdf'], 'resume.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [file] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/does not look like a pdf/i);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('rejects a file over the 10MB cap without calling the server', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<ResumeCard />);

    const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'resume.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [bigFile] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/over the 10mb limit/i);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('uploads a valid PDF and shows what the server read out of it', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pages: 2, pages_read: 2, characters: 3400, bytes: 55000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<ResumeCard />);

    const file = new File(['%PDF-1.4 ...'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [file] } });

    expect(await screen.findByText(/2 pages, 2 read, 3,400 characters/i)).toBeInTheDocument();
    expect(doFetch).toHaveBeenCalledWith(
      '/api/profile/resume?filename=resume.pdf',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/pdf' } }),
    );
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TextDocumentCard } from './text-document-card.tsx';

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

describe('TextDocumentCard', () => {
  it('loads the stored text and shows the byte count against the cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text: 'hello', stored: true })));
    renderWithClient(<TextDocumentCard name="background" label="Background" perDocumentCap={100} />);

    const textarea = await screen.findByLabelText('Background');
    await waitFor(() => expect(textarea).toHaveValue('hello'));
    expect(screen.getByText(/5 \/ 100 bytes/)).toBeInTheDocument();
  });

  it('disables Save until the text changes, and again once over the cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text: 'hi', stored: true })));
    renderWithClient(<TextDocumentCard name="background" label="Background" perDocumentCap={5} />);

    const textarea = await screen.findByLabelText('Background');
    await waitFor(() => expect(textarea).toHaveValue('hi'));
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'hi there' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/over the per-document limit/)).toBeInTheDocument();
  });

  it('saves the edited text', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ text: 'hi', stored: true }))
      .mockResolvedValueOnce(jsonResponse({ bytes: 8 }))
      .mockResolvedValue(jsonResponse({ text: 'hi there', stored: true }));
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<TextDocumentCard name="background" label="Background" perDocumentCap={100} />);

    const textarea = await screen.findByLabelText('Background');
    await waitFor(() => expect(textarea).toHaveValue('hi'));
    fireEvent.change(textarea, { target: { value: 'hi there' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(doFetch).toHaveBeenCalledWith(
        '/api/profile/background',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'hi there' }) }),
      ),
    );
  });

  it('shows a reset-to-default action only when resettable, hidden while already on the default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text: 'default text', stored: false })));
    renderWithClient(<TextDocumentCard name="judge-prompt" label="Judge prompt" perDocumentCap={100} resettable />);

    await screen.findByLabelText('Judge prompt');
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();
    expect(screen.getByText(/using the default talenttrove ships/i)).toBeInTheDocument();
  });

  it('shows an error instead of an empty editable form when the document fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not signed in' }, 401)));
    renderWithClient(<TextDocumentCard name="background" label="Background" perDocumentCap={100} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('Background')).not.toBeInTheDocument();
  });
});

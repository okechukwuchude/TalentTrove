// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignInPage from './page.tsx';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Gets the email step to the code step via a mocked successful send-code call. */
async function reachCodeStep(doFetch: ReturnType<typeof vi.fn>): Promise<void> {
  render(<SignInPage />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /send code/i }));
  await screen.findByLabelText(/^code$/i);
  doFetch.mockClear();
}

describe('SignInPage — email step', () => {
  it('disables "Send code" until an email is typed', () => {
    render(<SignInPage />);
    expect(screen.getByRole('button', { name: /send code/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
    expect(screen.getByRole('button', { name: /send code/i })).toBeEnabled();
  });

  it('shows the server error when the address is refused, and stays on this step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'that does not look like an email address' }, 400)));
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('that does not look like an email address');
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^code$/i)).not.toBeInTheDocument();
  });

  it('moves to the code step once the server accepts the address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ sent: true })));
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    expect(await screen.findByLabelText(/^code$/i)).toBeInTheDocument();
  });
});

describe('SignInPage — code step', () => {
  it('disables "Verify" until a code is typed', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ sent: true }));
    vi.stubGlobal('fetch', doFetch);
    await reachCodeStep(doFetch);

    expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: /verify/i })).toBeEnabled();
  });

  it('shows the server error when the code is refused', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ sent: true }));
    vi.stubGlobal('fetch', doFetch);
    await reachCodeStep(doFetch);

    doFetch.mockResolvedValue(jsonResponse({ error: 'that code is wrong or has expired' }, 400));
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('that code is wrong or has expired');
    expect(push).not.toHaveBeenCalled();
  });

  it('navigates home once the code is verified', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ sent: true }));
    vi.stubGlobal('fetch', doFetch);
    await reachCodeStep(doFetch);

    doFetch.mockResolvedValue(jsonResponse({ email: 'a@example.com' }));
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(refresh).toHaveBeenCalled();
  });

  it('re-enables the form after a network failure, with an error shown', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ sent: true }));
    vi.stubGlobal('fetch', doFetch);
    await reachCodeStep(doFetch);

    doFetch.mockRejectedValue(new Error('network down'));
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
    expect(screen.getByRole('button', { name: /verify/i })).toBeEnabled();
  });
});

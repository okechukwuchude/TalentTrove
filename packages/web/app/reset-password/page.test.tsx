// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResetPasswordPage from './page.tsx';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('token=reset-token-value'),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('ResetPasswordPage', () => {
  it('submits the token from the URL with the new password, then redirects to sign-in', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', doFetch);
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/sign-in'));
    expect(doFetch).toHaveBeenCalledWith(
      '/api/auth/reset-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'reset-token-value', newPassword: 'new-password-1' }),
      }),
    );
  });

  it('shows the server error and stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'that reset link is invalid or has expired' }, 400)));
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('that reset link is invalid or has expired');
    expect(push).not.toHaveBeenCalled();
  });
});

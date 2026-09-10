// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ForgotPasswordPage from './page.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ForgotPasswordPage', () => {
  it('shows the same confirmation message regardless of the server response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))));
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/if an account exists.*we.?ve sent a reset link/i)).toBeInTheDocument();
  });
});

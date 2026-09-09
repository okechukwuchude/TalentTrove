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

describe('SignInPage', () => {
  it('defaults to Sign in mode and posts to /api/auth/sign-in', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ email: 'a@example.com' }));
    vi.stubGlobal('fetch', doFetch);
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(doFetch).toHaveBeenCalledWith('/api/auth/sign-in', expect.objectContaining({ method: 'POST' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('toggles to Create account mode and posts to /api/auth/sign-up', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ email: 'a@example.com' }));
    vi.stubGlobal('fetch', doFetch);
    render(<SignInPage />);

    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /^create account$/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(doFetch).toHaveBeenCalledWith('/api/auth/sign-up', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the server error and stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'that email or password is wrong' }, 400)));
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('that email or password is wrong');
    expect(push).not.toHaveBeenCalled();
  });

  it('links to the forgot-password page', () => {
    render(<SignInPage />);
    expect(screen.getByRole('link', { name: /forgot.*password/i })).toHaveAttribute('href', '/forgot-password');
  });
});

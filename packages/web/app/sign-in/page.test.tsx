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

describe('SignInPage', () => {
  it('disables the submit button until a code is typed', () => {
    render(<SignInPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('shows the server error when the code is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'that code has expired' }), { status: 400 })),
    );
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('that code has expired');
    expect(push).not.toHaveBeenCalled();
  });

  it('navigates home once the code is accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ email: 'a@example.com' }), { status: 200 })),
    );
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(refresh).toHaveBeenCalled();
  });

  it('re-enables the form after a network failure, with an error shown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });
});

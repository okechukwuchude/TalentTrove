// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignOutButton } from './sign-out-button.tsx';

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

describe('SignOutButton', () => {
  it('calls the logout endpoint and returns to the home page', async () => {
    const doFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ signedIn: false })));
    vi.stubGlobal('fetch', doFetch);

    render(<SignOutButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(doFetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' }));
    expect(push).toHaveBeenCalledWith('/');
    expect(refresh).toHaveBeenCalled();
  });
});

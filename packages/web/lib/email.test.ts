import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null });
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } })),
}));

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key';
  send.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendPasswordResetEmail', () => {
  it('sends to the given address with the reset link in the body', async () => {
    const { sendPasswordResetEmail } = await import('./email.ts');
    await sendPasswordResetEmail('a@example.com', 'http://localhost:3000/reset-password?token=abc');

    expect(send).toHaveBeenCalledTimes(1);
    const [call] = send.mock.calls[0]!;
    expect(call.to).toBe('a@example.com');
    expect(call.text).toContain('http://localhost:3000/reset-password?token=abc');
  });

  it('throws when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY;
    vi.resetModules();
    const { sendPasswordResetEmail } = await import('./email.ts');
    await expect(sendPasswordResetEmail('a@example.com', 'http://x/reset')).rejects.toThrow(/RESEND_API_KEY/);
  });
});

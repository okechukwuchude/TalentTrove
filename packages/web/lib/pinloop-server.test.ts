// packages/web/lib/pinloop-server.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  PinloopServerError,
  callAsAccount,
  refreshPass,
  requestEmailCode,
  tradeHandoffCode,
  verifyEmailCode,
} from './pinloop-server.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('tradeHandoffCode', () => {
  it('returns the pass the server hands back for a valid code', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'a1', refresh_token: 'r1', email: 'a@example.com' }));
    const pass = await tradeHandoffCode('123456', doFetch as unknown as typeof fetch);
    expect(pass).toEqual({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/handoff/trade'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when the server accepts the code but sends back no pass', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    await expect(tradeHandoffCode('123456', doFetch as unknown as typeof fetch)).rejects.toThrow(
      PinloopServerError,
    );
  });
});

describe('callAsAccount', () => {
  it('makes the call with the access token and returns the answer', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const result = await callAsAccount({ accessToken: 'a1' }, '/profile', {}, doFetch as unknown as typeof fetch);
    expect(result.json).toEqual({ ok: true });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/profile'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer a1' }) }),
    );
  });

  it('renews the pass once and retries after a 401, then succeeds', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'a2', refresh_token: 'r2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await callAsAccount(
      { accessToken: 'a1', refreshToken: 'r1' },
      '/profile',
      {},
      doFetch as unknown as typeof fetch,
    );
    expect(result.json).toEqual({ ok: true });
    expect(result.renewedPass).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it('throws without retrying when there is no refresh token to renew with', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'expired' }, 401));
    await expect(
      callAsAccount({ accessToken: 'a1' }, '/profile', {}, doFetch as unknown as typeof fetch),
    ).rejects.toThrow(PinloopServerError);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('throws when the renewed retry also fails, without retrying a third time', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'a2' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'still no' }, 401));
    await expect(
      callAsAccount({ accessToken: 'a1', refreshToken: 'r1' }, '/profile', {}, doFetch as unknown as typeof fetch),
    ).rejects.toThrow(PinloopServerError);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });
});

describe('refreshPass', () => {
  it('throws when the server refuses the renewal', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad refresh token' }, 401));
    await expect(refreshPass('r1', doFetch as unknown as typeof fetch)).rejects.toThrow(PinloopServerError);
  });
});

describe('rawCall error fallback', () => {
  it('falls back to the HTTP status when the error body is empty, not to a blank message', async () => {
    const doFetch = vi.fn().mockResolvedValue(new Response('', { status: 502 }));
    await expect(
      callAsAccount({ accessToken: 'a1' }, '/profile', {}, doFetch as unknown as typeof fetch),
    ).rejects.toThrow('HTTP 502');
  });
});

describe('requestEmailCode', () => {
  it('asks the server to email a code to the given address', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    await requestEmailCode('a@example.com', doFetch as unknown as typeof fetch);
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/send-code'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
    );
  });

  it('surfaces the server refusal (e.g. an invalid address, or too many requests)', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'that does not look like an email address' }, 400));
    await expect(requestEmailCode('not-an-email', doFetch as unknown as typeof fetch)).rejects.toThrow(
      PinloopServerError,
    );
  });
});

describe('verifyEmailCode', () => {
  it('returns the pass the server hands back for a matching code', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'a1', refresh_token: 'r1', email: 'a@example.com' }));
    const pass = await verifyEmailCode('a@example.com', '123456', doFetch as unknown as typeof fetch);
    expect(pass).toEqual({ accessToken: 'a1', refreshToken: 'r1', email: 'a@example.com' });
    expect(doFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-code'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', code: '123456' }),
      }),
    );
  });

  it('throws when the server accepts the call but sends back no pass', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    await expect(
      verifyEmailCode('a@example.com', '123456', doFetch as unknown as typeof fetch),
    ).rejects.toThrow(PinloopServerError);
  });

  it('surfaces the server refusal for a wrong or expired code', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'that code is wrong or has expired' }, 400));
    await expect(
      verifyEmailCode('a@example.com', '000000', doFetch as unknown as typeof fetch),
    ).rejects.toThrow(PinloopServerError);
  });
});

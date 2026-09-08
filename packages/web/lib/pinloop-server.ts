import { HANDOFF_TRADE_PATH, SEND_CODE_PATH, VERIFY_CODE_PATH } from '@pinloop/shared';

const SERVER_URL = process.env.PINLOOP_SERVER_URL ?? 'https://api.pinloop.ai';

export class PinloopServerError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type Pass = {
  accessToken: string;
  refreshToken?: string;
};

type CallOptions = {
  method?: string;
  body?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  token?: string;
};

async function rawCall(
  path: string,
  options: CallOptions,
  doFetch: typeof fetch,
): Promise<{ json: unknown; status: number }> {
  const headers: Record<string, string> = { 'pinloop-web-version': '0.0.0' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.bytes !== undefined) headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await doFetch(`${SERVER_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: (options.bytes !== undefined
      ? options.bytes
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body)) as BodyInit | undefined,
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (response.status >= 400) {
    const asRecord = json as { error?: string; message?: string } | undefined;
    // An empty body must not produce an empty message (`''` is not nullish,
    // so `??` alone would never reach the fallback), and a non-JSON body
    // (an HTML error page from a proxy, say) must not become the message
    // verbatim — cap it.
    const fallback = text.trim() === '' ? `HTTP ${response.status}` : text.slice(0, 200);
    const message = asRecord?.error ?? asRecord?.message ?? fallback;
    throw new PinloopServerError(message, response.status);
  }

  return { json, status: response.status };
}

export async function tradeHandoffCode(
  code: string,
  doFetch: typeof fetch = fetch,
): Promise<Pass & { email?: string }> {
  const { json } = await rawCall(HANDOFF_TRADE_PATH, { method: 'POST', body: { code } }, doFetch);
  const asRecord = json as { access_token?: string; refresh_token?: string; email?: string } | undefined;
  if (typeof asRecord?.access_token !== 'string' || asRecord.access_token === '') {
    throw new PinloopServerError('that code was taken but carried no pass', 400);
  }
  return {
    accessToken: asRecord.access_token,
    refreshToken: asRecord.refresh_token,
    email: asRecord.email,
  };
}

// requestEmailCode/verifyEmailCode call the server's own email-code endpoints
// directly, rather than relying on pinloop.ai's hosted sign-in page: that
// page's short-code hand-off (HANDOFF_PATH/HANDOFF_TRADE_PATH) turned out,
// in practice, to only work for the CLI's loopback-listener scenario — a
// plain browser tab opened with no listener never gets shown a code at all.
// These two endpoints are the same ones that page's own "email me a code"
// option calls, so this sidesteps that page entirely.
export async function requestEmailCode(email: string, doFetch: typeof fetch = fetch): Promise<void> {
  await rawCall(SEND_CODE_PATH, { method: 'POST', body: { email } }, doFetch);
}

export async function verifyEmailCode(
  email: string,
  code: string,
  doFetch: typeof fetch = fetch,
): Promise<Pass & { email?: string }> {
  const { json } = await rawCall(VERIFY_CODE_PATH, { method: 'POST', body: { email, code } }, doFetch);
  const asRecord = json as { access_token?: string; refresh_token?: string; email?: string } | undefined;
  if (typeof asRecord?.access_token !== 'string' || asRecord.access_token === '') {
    throw new PinloopServerError('that code was accepted but carried no pass', 400);
  }
  return {
    accessToken: asRecord.access_token,
    refreshToken: asRecord.refresh_token,
    email: asRecord.email ?? email,
  };
}

export async function refreshPass(refreshTokenValue: string, doFetch: typeof fetch = fetch): Promise<Pass> {
  const { json } = await rawCall(
    '/auth/refresh',
    { method: 'POST', body: { refresh_token: refreshTokenValue } },
    doFetch,
  );
  const asRecord = json as { access_token?: string; refresh_token?: string } | undefined;
  if (typeof asRecord?.access_token !== 'string' || asRecord.access_token === '') {
    throw new PinloopServerError('the renewal did not return a pass', 401);
  }
  return {
    accessToken: asRecord.access_token,
    refreshToken: asRecord.refresh_token ?? refreshTokenValue,
  };
}

export async function callAsAccount(
  pass: Pass,
  path: string,
  options: { method?: string; body?: unknown; bytes?: Uint8Array; contentType?: string } = {},
  doFetch: typeof fetch = fetch,
): Promise<{ json: unknown; status: number; renewedPass?: Pass }> {
  try {
    return await rawCall(path, { ...options, token: pass.accessToken }, doFetch);
  } catch (error) {
    const wasExpired = error instanceof PinloopServerError && error.status === 401;
    if (!wasExpired || !pass.refreshToken) throw error;
    const renewedPass = await refreshPass(pass.refreshToken, doFetch);
    const result = await rawCall(path, { ...options, token: renewedPass.accessToken }, doFetch);
    return { ...result, renewedPass };
  }
}

import { sealData, unsealData } from 'iron-session';

export const SESSION_COOKIE_NAME = 'pinloop_session';

export type SessionData = {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
};

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a string of at least 32 characters');
  }
  return secret;
}

function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export async function readSession(cookieHeader: string | null): Promise<SessionData> {
  const raw = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!raw) return {};
  // sessionSecret() is called outside the try: a missing/too-short
  // SESSION_SECRET is a configuration error that must propagate loudly, not
  // be swallowed into an ordinary "signed out" state the way a genuinely
  // tampered cookie is.
  const password = sessionSecret();
  try {
    return await unsealData<SessionData>(raw, { password });
  } catch {
    // A tampered or stale cookie is treated as no session at all, never as an
    // error — the person is simply signed out and can sign in again.
    return {};
  }
}

// 30 days: how long a person stays signed in before they need to go through
// the sign-in flow again from scratch. Independent of the access/refresh
// token lifetimes — callAsAccount already renews the access token as needed
// within this window. Passed explicitly as iron-session's own `ttl` too —
// its default is 14 days, baked into the seal itself regardless of the
// cookie's Max-Age, so without this the cookie would silently stop working
// 16 days before it says it would.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function sealSession(data: SessionData): Promise<string> {
  return sealData(data, { password: sessionSecret(), ttl: SESSION_MAX_AGE_SECONDS });
}

// Chrome and Firefox treat http://localhost as trustworthy and store a
// Secure cookie there anyway; Safari does not. Without this, testing the
// sign-in flow locally in Safari would silently look broken — sign-in
// appears to succeed and the person looks signed out again immediately,
// with no error anywhere to explain why.
const COOKIE_SECURITY_FLAG = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';

export function sessionCookieHeader(sealedValue: string): string {
  return (
    `${SESSION_COOKIE_NAME}=${sealedValue}; HttpOnly; ${COOKIE_SECURITY_FLAG}SameSite=Lax; ` +
    `Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; ${COOKIE_SECURITY_FLAG}SameSite=Lax; Path=/; Max-Age=0`;
}

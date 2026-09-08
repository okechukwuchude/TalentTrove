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
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > -1) {
      const key = trimmed.substring(0, eqIndex);
      if (key === name) {
        return trimmed.substring(eqIndex + 1);
      }
    }
  }
  return undefined;
}

export async function readSession(cookieHeader: string | null): Promise<SessionData> {
  const raw = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!raw) return {};
  try {
    return await unsealData<SessionData>(raw, { password: sessionSecret() });
  } catch {
    // A tampered or stale cookie is treated as no session at all, never as an
    // error — the person is simply signed out and can sign in again.
    return {};
  }
}

export async function sealSession(data: SessionData): Promise<string> {
  return sealData(data, { password: sessionSecret() });
}

// 30 days: how long a person stays signed in before they need to go through
// the sign-in flow again from scratch. Independent of the access/refresh
// token lifetimes — callAsAccount already renews the access token as needed
// within this window.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function sessionCookieHeader(sealedValue: string): string {
  return (
    `${SESSION_COOKIE_NAME}=${sealedValue}; HttpOnly; Secure; SameSite=Lax; ` +
    `Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

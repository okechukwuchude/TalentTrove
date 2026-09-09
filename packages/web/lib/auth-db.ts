import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db.ts';
import { passwordResetTokens, sessions, users } from '../db/schema.ts';
import { generateToken, hashToken } from './tokens.ts';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export type AuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
};

export async function createUser(email: string, passwordHash: string): Promise<{ id: string; email: string }> {
  const [row] = await getDb().insert(users).values({ email, passwordHash }).returning({ id: users.id, email: users.email });
  return row!;
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const [row] = await getDb().select().from(users).where(eq(users.email, email));
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
  };
}

export async function recordFailedSignIn(userId: string): Promise<void> {
  const [row] = await getDb().select({ failedAttempts: users.failedAttempts }).from(users).where(eq(users.id, userId));
  if (!row) return;
  const nextCount = row.failedAttempts + 1;
  const lockedUntil = nextCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
  await getDb().update(users).set({ failedAttempts: nextCount, lockedUntil }).where(eq(users.id, userId));
}

export async function resetFailedAttempts(userId: string): Promise<void> {
  await getDb().update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
}

export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  await getDb().insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
  });
  return token;
}

export async function resolveSessionToken(rawToken: string): Promise<{ userId: string; email: string } | null> {
  const [row] = await getDb()
    .select({ userId: sessions.userId, email: users.email, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, hashToken(rawToken)));
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId, email: row.email };
}

export async function deleteSession(rawToken: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, hashToken(rawToken)));
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

const RESET_TOKEN_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = generateToken();
  await getDb().insert(passwordResetTokens).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + RESET_TOKEN_MAX_AGE_MS),
  });
  return token;
}

export async function consumePasswordResetToken(rawToken: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(rawToken);
  const [row] = await getDb()
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.consumedAt)))
    .returning({ userId: passwordResetTokens.userId, expiresAt: passwordResetTokens.expiresAt });
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId };
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await getDb().update(users).set({ passwordHash }).where(eq(users.id, userId));
}

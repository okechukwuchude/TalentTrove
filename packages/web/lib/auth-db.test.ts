import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('auth-db: users & sessions', () => {
  let authDb: typeof import('./auth-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('creates a user and finds it by email', async () => {
    const created = await authDb.createUser('a@example.com', 'hashed-password');
    const found = await authDb.findUserByEmail('a@example.com');
    expect(found?.id).toBe(created.id);
    expect(found?.passwordHash).toBe('hashed-password');
    expect(found?.failedAttempts).toBe(0);
    expect(found?.lockedUntil).toBeNull();
  });

  it('returns null for an email with no account', async () => {
    expect(await authDb.findUserByEmail('nobody@example.com')).toBeNull();
  });

  it('locks the account after 5 recorded failures, and resetFailedAttempts clears it', async () => {
    const user = await authDb.createUser('lockout@example.com', 'hashed-password');
    for (let i = 0; i < 5; i++) await authDb.recordFailedSignIn(user.id);

    const locked = await authDb.findUserByEmail('lockout@example.com');
    expect(locked?.failedAttempts).toBe(5);
    expect(locked?.lockedUntil).not.toBeNull();
    expect(locked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    await authDb.resetFailedAttempts(user.id);
    const reset = await authDb.findUserByEmail('lockout@example.com');
    expect(reset?.failedAttempts).toBe(0);
    expect(reset?.lockedUntil).toBeNull();
  });

  it('creates a session and resolves it back to the user', async () => {
    const user = await authDb.createUser('session@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const resolved = await authDb.resolveSessionToken(token);
    expect(resolved).toEqual({ userId: user.id, email: 'session@example.com' });
  });

  it('returns null for a token that was never issued', async () => {
    expect(await authDb.resolveSessionToken('not-a-real-token')).toBeNull();
  });

  it('deleteSession makes the token stop resolving', async () => {
    const user = await authDb.createUser('logout@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    await authDb.deleteSession(token);
    expect(await authDb.resolveSessionToken(token)).toBeNull();
  });

  it('deleteAllSessionsForUser removes every session for that user, leaving others untouched', async () => {
    const user = await authDb.createUser('multi@example.com', 'hashed-password');
    const other = await authDb.createUser('other@example.com', 'hashed-password');
    const tokenA = await authDb.createSession(user.id);
    const tokenB = await authDb.createSession(user.id);
    const otherToken = await authDb.createSession(other.id);

    await authDb.deleteAllSessionsForUser(user.id);

    expect(await authDb.resolveSessionToken(tokenA)).toBeNull();
    expect(await authDb.resolveSessionToken(tokenB)).toBeNull();
    expect(await authDb.resolveSessionToken(otherToken)).not.toBeNull();
  });

  it('creates a password reset token and consumes it exactly once', async () => {
    const user = await authDb.createUser('reset@example.com', 'hashed-password');
    const token = await authDb.createPasswordResetToken(user.id);

    const first = await authDb.consumePasswordResetToken(token);
    expect(first).toEqual({ userId: user.id });

    const second = await authDb.consumePasswordResetToken(token);
    expect(second).toBeNull();
  });

  it('returns null for a reset token that was never issued', async () => {
    expect(await authDb.consumePasswordResetToken('not-a-real-token')).toBeNull();
  });
});

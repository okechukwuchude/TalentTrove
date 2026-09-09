import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { verifyPassword } from '../../../../lib/passwords.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!testDatabaseUrl)('POST /api/auth/reset-password', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let POST: typeof import('./route.ts')['POST'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    ({ POST } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from sessions`;
    await sql`delete from password_reset_tokens`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('updates the password, consumes the token, and signs out every existing session', async () => {
    const user = await authDb.createUser('a@example.com', 'old-hash-placeholder');
    const sessionToken = await authDb.createSession(user.id);
    const resetToken = await authDb.createPasswordResetToken(user.id);

    const response = await POST(jsonRequest({ token: resetToken, newPassword: 'new-password-1' }));
    expect(response.status).toBe(200);

    const updated = await authDb.findUserByEmail('a@example.com');
    expect(await verifyPassword('new-password-1', updated!.passwordHash)).toBe(true);
    expect(await authDb.resolveSessionToken(sessionToken)).toBeNull();
  });

  it('rejects an invalid token', async () => {
    const response = await POST(jsonRequest({ token: 'not-a-real-token', newPassword: 'new-password-1' }));
    expect(response.status).toBe(400);
  });

  it('rejects a token that was already used once', async () => {
    const user = await authDb.createUser('a@example.com', 'old-hash-placeholder');
    const resetToken = await authDb.createPasswordResetToken(user.id);
    await POST(jsonRequest({ token: resetToken, newPassword: 'new-password-1' }));

    const response = await POST(jsonRequest({ token: resetToken, newPassword: 'another-password-2' }));
    expect(response.status).toBe(400);
  });

  it('rejects a weak new password', async () => {
    const user = await authDb.createUser('a@example.com', 'old-hash-placeholder');
    const resetToken = await authDb.createPasswordResetToken(user.id);

    const response = await POST(jsonRequest({ token: resetToken, newPassword: 'short' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least 8 characters/i);
  });
});

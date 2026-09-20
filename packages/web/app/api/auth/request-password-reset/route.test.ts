import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const sendPasswordResetEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../lib/email.ts', () => ({ sendPasswordResetEmail }));

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!testDatabaseUrl)('POST /api/auth/request-password-reset', () => {
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
    await sql`delete from password_reset_tokens`;
    await sql`delete from users`;
    sendPasswordResetEmail.mockClear();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('sends a reset email when the account exists', async () => {
    await authDb.createUser('a@example.com', 'hashed-password');
    const response = await POST(jsonRequest({ email: 'a@example.com' }));

    expect(response.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [emailArg, linkArg] = sendPasswordResetEmail.mock.calls[0]!;
    expect(emailArg).toBe('a@example.com');
    expect(linkArg).toContain('/reset-password?token=');
  });

  it('returns 200 without sending anything when the account does not exist', async () => {
    const response = await POST(jsonRequest({ email: 'nobody@example.com' }));
    expect(response.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('uses APP_ORIGIN for the reset link, ignoring the request Host, when it is set', async () => {
    const previous = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = 'https://app.talenttrove.example';
    try {
      await authDb.createUser('b@example.com', 'hashed-password');
      const request = new Request('http://attacker-controlled.example/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: 'attacker-controlled.example' },
        body: JSON.stringify({ email: 'b@example.com' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [, linkArg] = sendPasswordResetEmail.mock.calls[0]!;
      expect(linkArg).toBe(`https://app.talenttrove.example/reset-password?token=${linkArg.split('token=')[1]}`);
      expect(linkArg).not.toContain('attacker-controlled.example');
    } finally {
      if (previous === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previous;
    }
  });

  it('falls back to the request origin outside production when APP_ORIGIN is unset', async () => {
    const previous = process.env.APP_ORIGIN;
    delete process.env.APP_ORIGIN;
    try {
      await authDb.createUser('c@example.com', 'hashed-password');
      const response = await POST(jsonRequest({ email: 'c@example.com' }));

      expect(response.status).toBe(200);
      expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [, linkArg] = sendPasswordResetEmail.mock.calls[0]!;
      expect(linkArg).toContain('http://localhost/reset-password?token=');
    } finally {
      if (previous === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previous;
    }
  });
});

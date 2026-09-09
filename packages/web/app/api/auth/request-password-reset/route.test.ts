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
});

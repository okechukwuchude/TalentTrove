import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/sign-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!testDatabaseUrl)('POST /api/auth/sign-up', () => {
  let POST: typeof import('./route.ts')['POST'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    ({ POST } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('creates an account and sets a session cookie', async () => {
    const response = await POST(jsonRequest({ email: 'a@example.com', password: 'password123' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'a@example.com' });
    expect(response.headers.get('set-cookie')).toContain('talenttrove_session=');

    const [row] = await sql`select email from users where email = 'a@example.com'`;
    expect(row?.email).toBe('a@example.com');
  });

  it('rejects a duplicate email', async () => {
    await POST(jsonRequest({ email: 'a@example.com', password: 'password123' }));
    const response = await POST(jsonRequest({ email: 'a@example.com', password: 'different123' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/already exists/i);
  });

  it('rejects a malformed email', async () => {
    const response = await POST(jsonRequest({ email: 'not-an-email', password: 'password123' }));
    expect(response.status).toBe(400);
  });

  it('rejects a password under 8 characters', async () => {
    const response = await POST(jsonRequest({ email: 'short@example.com', password: 'short' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least 8 characters/i);
  });
});

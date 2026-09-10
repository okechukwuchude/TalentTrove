import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe.skipIf(!testDatabaseUrl)('GET /api/profile', () => {
  let authDb: typeof import('../../../lib/auth-db.ts');
  let profileDb: typeof import('../../../lib/profile-db.ts');
  let GET: typeof import('./route.ts')['GET'];
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../lib/auth-db.ts');
    profileDb = await import('../../../lib/profile-db.ts');
    ({ GET } = await import('./route.ts'));
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from profile_documents`;
    await sql`delete from sessions`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function signedInCookie(): Promise<{ cookie: string; userId: string }> {
    const user = await authDb.createUser('a@example.com', 'hashed-password');
    const token = await authDb.createSession(user.id);
    const sealed = await sealSession({ token });
    return { cookie: sessionCookieHeader(sealed).split(';')[0]!, userId: user.id };
  }

  it('returns 401 when not signed in', async () => {
    const response = await GET(new Request('http://localhost/api/profile'));
    expect(response.status).toBe(401);
  });

  it('returns an empty list for a signed-in account with nothing stored', async () => {
    const { cookie } = await signedInCookie();
    const response = await GET(new Request('http://localhost/api/profile', { headers: { cookie } }));
    expect(await response.json()).toEqual({ rows: [] });
  });

  it('returns stored documents in the shape the frontend expects', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'constraints', 'must be remote');
    await profileDb.upsertFileDocument(userId, 'resume', Buffer.from('%PDF-1.4 fake'), 'my-resume.pdf');

    const response = await GET(new Request('http://localhost/api/profile', { headers: { cookie } }));
    const body = (await response.json()) as { rows: Record<string, unknown>[] };
    expect(body.rows).toHaveLength(2);

    const constraints = body.rows.find((row) => row.name === 'constraints');
    expect(constraints).toMatchObject({ name: 'constraints', kind: 'text', bytes: 14 });
    expect(typeof constraints?.updated_at).toBe('string');

    const resume = body.rows.find((row) => row.name === 'resume');
    expect(resume).toMatchObject({ name: 'resume', kind: 'file', original_filename: 'my-resume.pdf' });
  });
});

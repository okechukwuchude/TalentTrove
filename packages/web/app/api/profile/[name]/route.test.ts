import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../../../db/migrate.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const params = (name: string) => ({ params: Promise.resolve({ name }) });

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

describe.skipIf(!testDatabaseUrl)('GET /api/profile/[name]', () => {
  let authDb: typeof import('../../../../lib/auth-db.ts');
  let profileDb: typeof import('../../../../lib/profile-db.ts');
  let route: typeof import('./route.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('../../../../lib/auth-db.ts');
    profileDb = await import('../../../../lib/profile-db.ts');
    route = await import('./route.ts');
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
    const response = await route.GET(new Request('http://localhost/api/profile/constraints'), params('constraints'));
    expect(response.status).toBe(401);
  });

  it('returns the stored text when a document is set', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'constraints', 'must be remote');

    const response = await route.GET(
      new Request('http://localhost/api/profile/constraints', { headers: { cookie } }),
      params('constraints'),
    );
    expect(await response.json()).toEqual({ text: 'must be remote', stored: true });
  });

  it('returns an empty string for an unset name with no shipped default', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.GET(
      new Request('http://localhost/api/profile/background', { headers: { cookie } }),
      params('background'),
    );
    expect(await response.json()).toEqual({ text: '', stored: false });
  });

  it('returns the shipped default text for an unset judge-prompt', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.GET(
      new Request('http://localhost/api/profile/judge-prompt', { headers: { cookie } }),
      params('judge-prompt'),
    );
    const body = (await response.json()) as { text: string; stored: boolean };
    expect(body.stored).toBe(false);
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text).toContain('constraints');
  });

  it('returns the shipped default text for an unset quick-judge-prompt', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.GET(
      new Request('http://localhost/api/profile/quick-judge-prompt', { headers: { cookie } }),
      params('quick-judge-prompt'),
    );
    const body = (await response.json()) as { text: string; stored: boolean };
    expect(body.stored).toBe(false);
    expect(body.text.length).toBeGreaterThan(0);
  });

  it('refuses to return a file document as text', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertFileDocument(userId, 'resume', Buffer.from('%PDF-1.4 fake'), 'r.pdf');

    const response = await route.GET(
      new Request('http://localhost/api/profile/resume', { headers: { cookie } }),
      params('resume'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    // wrongKindRefusal('resume') is the resume-specific message from
    // @pinloop/shared's registry.ts ("the resume holds a PDF file, not
    // text..."), not the generic "holds a file, not text." form — its
    // wording is pinned per CLAUDE.md, so the assertion is widened to
    // match either phrasing rather than editing the shared string.
    expect(body.error).toMatch(/holds a( \S+)? file, not text/i);
  });
});

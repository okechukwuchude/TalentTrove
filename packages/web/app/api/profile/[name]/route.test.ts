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

describe.skipIf(!testDatabaseUrl)('POST /api/profile/[name]', () => {
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
    const response = await route.POST(
      new Request('http://localhost/api/profile/constraints', { method: 'POST' }),
      params('constraints'),
    );
    expect(response.status).toBe(401);
  });

  it('stores a text document', async () => {
    const { cookie, userId } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/constraints', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'must be remote' }),
      }),
      params('constraints'),
    );
    expect(await response.json()).toEqual({ text: 'must be remote', stored: true });

    const detail = await profileDb.getProfileDocument(userId, 'constraints');
    expect(detail?.textContent).toBe('must be remote');
  });

  it('rejects an illegal custom document name', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/Not A Legal Name', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x' }),
      }),
      params('Not A Legal Name'),
    );
    expect(response.status).toBe(400);
  });

  it('accepts a legal custom document name', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/my-notes', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a custom note' }),
      }),
      params('my-notes'),
    );
    expect(response.status).toBe(200);
  });

  it('refuses text sent to resume (the file-kind name)', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/resume', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'not a pdf' }),
      }),
      params('resume'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    // wrongKindRefusal('resume') is the resume-specific message from
    // @pinloop/shared's registry.ts ("the resume holds a PDF file, not
    // text..."), not the generic "holds a file, not text." form -- its
    // wording is pinned per CLAUDE.md, so the assertion is widened to
    // match either phrasing rather than editing the shared string. Same
    // asymmetry as the GET describe block above.
    expect(body.error).toMatch(/holds a( \S+)? file, not text/i);
  });

  it('refuses a PDF sent to a text-kind name', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/constraints', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: Buffer.from('%PDF-1.4 fake'),
      }),
      params('constraints'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/holds text, not a file/i);
  });

  it('refuses a text document over the per-document cap', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/background', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(70_000) }),
      }),
      params('background'),
    );
    expect(response.status).toBe(413);
  });

  it('refuses a text document that would push the whole profile over its cap', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'background', 'x'.repeat(60_000));
    await profileDb.upsertTextDocument(userId, 'preferences', 'x'.repeat(60_000));
    await profileDb.upsertTextDocument(userId, 'application-instructions', 'x'.repeat(60_000));
    await profileDb.upsertTextDocument(userId, 'judge-prompt', 'x'.repeat(60_000));

    const response = await route.POST(
      new Request('http://localhost/api/profile/quick-judge-prompt', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(30_000) }),
      }),
      params('quick-judge-prompt'),
    );
    expect(response.status).toBe(413);
  });

  it('re-saving the same text document at a smaller size never trips the whole-profile cap', async () => {
    const { cookie, userId } = await signedInCookie();
    await profileDb.upsertTextDocument(userId, 'background', 'x'.repeat(200_000));

    const response = await route.POST(
      new Request('http://localhost/api/profile/background', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'much shorter now' }),
      }),
      params('background'),
    );
    expect(response.status).toBe(200);
  });

  it('rejects a PDF over the file cap', async () => {
    const { cookie } = await signedInCookie();
    const oversized = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(10 * 1024 * 1024 + 1, 'a')]);
    const response = await route.POST(
      new Request('http://localhost/api/profile/resume?filename=big.pdf', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: oversized,
      }),
      params('resume'),
    );
    expect(response.status).toBe(413);
  });

  it('rejects a file that does not begin like a PDF', async () => {
    const { cookie } = await signedInCookie();
    const response = await route.POST(
      new Request('http://localhost/api/profile/resume?filename=fake.pdf', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: Buffer.from('not a real pdf header'),
      }),
      params('resume'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/%PDF-/);
  });

  it('stores a valid resume PDF and reports parse stats', async () => {
    const { cookie, userId } = await signedInCookie();
    // The same minimal-but-valid PDF-with-text fixture from lib/pdf.test.ts
    // (corrected xref byte offsets — see Task 2's fixture for provenance).
    const validPdf = Buffer.from(
      `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 200 200]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 52>>
stream
BT /F1 24 Tf 10 100 Td (Hello resume) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
0000000211 00000 n
0000000272 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
362
%%EOF`,
      'latin1',
    );

    const response = await route.POST(
      new Request('http://localhost/api/profile/resume?filename=my-resume.pdf', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/pdf' },
        body: validPdf,
      }),
      params('resume'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'resume', kind: 'file', original_filename: 'my-resume.pdf' });
    expect(body.pages).toBe(1);
    expect((body.characters as number)).toBeGreaterThan(0);

    const stored = await profileDb.getProfileDocument(userId, 'resume');
    expect(stored?.originalFilename).toBe('my-resume.pdf');
  });
});

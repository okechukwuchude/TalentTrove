import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('profile-db', () => {
  let authDb: typeof import('./auth-db.ts');
  let profileDb: typeof import('./profile-db.ts');
  let sql: ReturnType<typeof postgres>;
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    profileDb = await import('./profile-db.ts');
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

  async function freshUserId(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    return user.id;
  }

  it('returns an empty list for a user with no documents', async () => {
    userId = await freshUserId();
    expect(await profileDb.listProfileDocuments(userId)).toEqual([]);
  });

  it('stores and retrieves a text document', async () => {
    userId = await freshUserId();
    const summary = await profileDb.upsertTextDocument(userId, 'constraints', 'must be remote');
    expect(summary).toMatchObject({ name: 'constraints', kind: 'text', bytes: 14, originalFilename: null });

    const detail = await profileDb.getProfileDocument(userId, 'constraints');
    expect(detail).toMatchObject({ name: 'constraints', kind: 'text', textContent: 'must be remote' });

    const list = await profileDb.listProfileDocuments(userId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'constraints', kind: 'text' });
  });

  it('upserting the same name replaces the stored value', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'first version');
    await profileDb.upsertTextDocument(userId, 'background', 'second version, longer');

    const detail = await profileDb.getProfileDocument(userId, 'background');
    expect(detail?.textContent).toBe('second version, longer');
    expect(await profileDb.listProfileDocuments(userId)).toHaveLength(1);
  });

  it('stores and retrieves a file document', async () => {
    userId = await freshUserId();
    const bytes = Buffer.from('%PDF-1.4 fake pdf bytes for this test');
    const summary = await profileDb.upsertFileDocument(userId, 'resume', bytes, 'my-resume.pdf');
    expect(summary).toMatchObject({
      name: 'resume',
      kind: 'file',
      bytes: bytes.length,
      originalFilename: 'my-resume.pdf',
    });

    const detail = await profileDb.getProfileDocument(userId, 'resume');
    expect(detail).toMatchObject({ name: 'resume', kind: 'file', originalFilename: 'my-resume.pdf' });
  });

  it('returns null for a document that was never stored', async () => {
    userId = await freshUserId();
    expect(await profileDb.getProfileDocument(userId, 'nothing-here')).toBeNull();
  });

  it('deletes a document, and deleting an unset one is a no-op', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'preferences', 'remote only');
    await profileDb.deleteProfileDocument(userId, 'preferences');
    expect(await profileDb.getProfileDocument(userId, 'preferences')).toBeNull();

    await profileDb.deleteProfileDocument(userId, 'never-stored');
  });

  it('sumOtherTextBytes excludes the named document and file documents', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'a'.repeat(10));
    await profileDb.upsertTextDocument(userId, 'preferences', 'b'.repeat(20));
    await profileDb.upsertFileDocument(userId, 'resume', Buffer.from('c'.repeat(1000)), 'r.pdf');

    expect(await profileDb.sumOtherTextBytes(userId, 'background')).toBe(20);
    expect(await profileDb.sumOtherTextBytes(userId, 'preferences')).toBe(10);
    expect(await profileDb.sumOtherTextBytes(userId, 'something-else')).toBe(30);
  });

  it('sumOtherTextBytes does not double-count when re-saving the same document', async () => {
    userId = await freshUserId();
    await profileDb.upsertTextDocument(userId, 'background', 'a'.repeat(100));
    const before = await profileDb.sumOtherTextBytes(userId, 'background');
    await profileDb.upsertTextDocument(userId, 'background', 'a'.repeat(500));
    const after = await profileDb.sumOtherTextBytes(userId, 'background');
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it('documents are scoped per user', async () => {
    const userA = await freshUserId();
    const userB = await freshUserId();
    await profileDb.upsertTextDocument(userA, 'background', 'user A background');
    expect(await profileDb.getProfileDocument(userB, 'background')).toBeNull();
  });
});

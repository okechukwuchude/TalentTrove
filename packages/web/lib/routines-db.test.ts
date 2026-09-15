import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../db/migrate.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('routines-db', () => {
  let authDb: typeof import('./auth-db.ts');
  let routinesDb: typeof import('./routines-db.ts');
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await runMigrations(testDatabaseUrl!);
    authDb = await import('./auth-db.ts');
    routinesDb = await import('./routines-db.ts');
    sql = postgres(testDatabaseUrl!);
  });

  afterEach(async () => {
    await sql`delete from routines`;
    await sql`delete from users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function freshUserId(): Promise<string> {
    const user = await authDb.createUser(`${crypto.randomUUID()}@example.com`, 'hashed-password');
    return user.id;
  }

  it('creates and lists a routine', async () => {
    const userId = await freshUserId();
    const created = await routinesDb.createRoutine(userId, 'backend', { q: 'backend engineer' }, null, null);
    expect(created).toEqual({ name: 'backend', filters: { q: 'backend engineer' }, judge_prompt: null, destination_tab: null });

    const list = await routinesDb.listRoutines(userId);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('backend');
  });

  it('lists routines in creation order', async () => {
    const userId = await freshUserId();
    await routinesDb.createRoutine(userId, 'first', {}, null, null);
    await routinesDb.createRoutine(userId, 'second', {}, null, null);

    const list = await routinesDb.listRoutines(userId);
    expect(list.map((r) => r.name)).toEqual(['first', 'second']);
  });

  it('finds a routine by name, scoped to the owning user', async () => {
    const userId = await freshUserId();
    const otherUserId = await freshUserId();
    await routinesDb.createRoutine(userId, 'mine', {}, null, null);

    expect(await routinesDb.findRoutineByName(userId, 'mine')).not.toBeNull();
    expect(await routinesDb.findRoutineByName(otherUserId, 'mine')).toBeNull();
    expect(await routinesDb.findRoutineByName(userId, 'nope')).toBeNull();
  });

  it('updates filters, judge_prompt, and destination_tab', async () => {
    const userId = await freshUserId();
    await routinesDb.createRoutine(userId, 'backend', { q: 'backend' }, null, null);

    const updated = await routinesDb.updateRoutine(userId, 'backend', {
      filters: { q: 'staff engineer' },
      judgePrompt: 'custom prompt',
      destinationTab: 'Backend Roles',
    });

    expect(updated).toEqual({
      name: 'backend',
      filters: { q: 'staff engineer' },
      judge_prompt: 'custom prompt',
      destination_tab: 'Backend Roles',
    });
  });

  it('returns null when updating a routine that does not exist', async () => {
    const userId = await freshUserId();
    expect(await routinesDb.updateRoutine(userId, 'nope', { judgePrompt: 'x' })).toBeNull();
  });

  it('deletes a routine, returning false when it did not exist', async () => {
    const userId = await freshUserId();
    await routinesDb.createRoutine(userId, 'backend', {}, null, null);

    expect(await routinesDb.deleteRoutine(userId, 'backend')).toBe(true);
    expect(await routinesDb.findRoutineByName(userId, 'backend')).toBeNull();
    expect(await routinesDb.deleteRoutine(userId, 'backend')).toBe(false);
  });
});

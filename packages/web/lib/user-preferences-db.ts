import { eq } from 'drizzle-orm';
import { getDb } from './db.ts';
import { userPreferences } from '../db/schema.ts';

export type UserPreferences = { roles: string[]; countries: string[] };

export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  const [row] = await getDb().select().from(userPreferences).where(eq(userPreferences.userId, userId));
  if (!row) return null;
  return { roles: row.roles ?? [], countries: row.countries ?? [] };
}

export async function setUserPreferences(userId: string, roles: string[], countries: string[]): Promise<void> {
  await getDb()
    .insert(userPreferences)
    .values({ userId, roles, countries, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { roles, countries, updatedAt: new Date() } });
}

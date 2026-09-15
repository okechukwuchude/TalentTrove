import { eq } from 'drizzle-orm';
import { getDb } from './db.ts';
import { appSettings } from '../db/schema.ts';
import { decryptSecret, encryptSecret } from './settings-crypto.ts';

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function getSecretSetting(key: string): Promise<string | null> {
  const raw = await getSetting(key);
  return raw === null ? null : decryptSecret(raw);
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb()
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function setSecretSetting(key: string, value: string): Promise<void> {
  await setSetting(key, encryptSecret(value));
}

export async function clearSetting(key: string): Promise<void> {
  await getDb().delete(appSettings).where(eq(appSettings.key, key));
}

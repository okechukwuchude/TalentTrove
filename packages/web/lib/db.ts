import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | undefined;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set to a Postgres connection string');
  return url;
}

/** Lazily built and cached, so tests can set DATABASE_URL before first use. */
export function getDb(): Db {
  if (!cached) cached = drizzle(postgres(databaseUrl()), { schema });
  return cached;
}

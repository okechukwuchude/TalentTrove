import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cachedClient: ReturnType<typeof postgres> | undefined;
let cached: Db | undefined;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set to a Postgres connection string');
  return url;
}

/** Lazily built and cached, so tests can set DATABASE_URL before first use. */
export function getDb(): Db {
  if (!cached) {
    // prepare: false — a pooled Neon connection (PgBouncer, transaction mode)
    // doesn't support session-scoped prepared statements, which postgres.js
    // uses by default; disabling them is harmless against a direct
    // connection too, so this is safe regardless of which DATABASE_URL kind
    // is configured.
    cachedClient = postgres(databaseUrl(), { prepare: false });
    cached = drizzle(cachedClient, { schema });
  }
  return cached;
}

/**
 * Closes the cached connection pool, if one was ever opened. Only meant for
 * one-shot CLI scripts (e.g. `db:ingest`'s `run-ingestion.ts` entrypoint):
 * postgres.js keeps its socket open indefinitely, so a script that calls
 * `getDb()` and never closes it hangs forever after finishing instead of
 * exiting on its own — confirmed by hand: `npm run db:ingest -w packages/web`
 * printed its summary and then sat there until killed, before this existed.
 * The server/cron request path must never call this: it relies on the
 * cached pool surviving across warm invocations.
 */
export async function closeDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end();
    cachedClient = undefined;
    cached = undefined;
  }
}

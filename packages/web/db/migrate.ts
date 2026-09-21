import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export async function runMigrations(databaseUrl: string): Promise<void> {
  // prepare: false — see lib/db.ts's identical option for why (Neon's pooled
  // connection string doesn't support prepared statements).
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = join(__dirname, 'migrations');
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

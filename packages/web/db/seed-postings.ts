import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { postings } from './schema.ts';

const FAKE_POSTINGS = [
  { title: 'Staff Software Engineer', company: 'Acme Corp', url: 'https://example.com/jobs/1', workplace: 'remote' },
  { title: 'Senior Backend Engineer', company: 'Globex', url: 'https://example.com/jobs/2', workplace: 'hybrid' },
  { title: 'Frontend Engineer', company: 'Initech', url: 'https://example.com/jobs/3', workplace: 'onsite' },
] as const;

/** Inserts a handful of fake postings for local manual testing of tabs. Not used by any route or user flow. */
export async function seedPostings(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client);
    await db.insert(postings).values(FAKE_POSTINGS.map((posting) => ({ ...posting, source: 'seed' })));
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be set to a Postgres connection string');
  await seedPostings(databaseUrl);
  console.log(`inserted ${FAKE_POSTINGS.length} fake postings`);
}

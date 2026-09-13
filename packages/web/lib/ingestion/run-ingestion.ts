import { sql as sqlOp } from 'drizzle-orm';
import { closeDb, getDb } from '../db.ts';
import { postings } from '../../db/schema.ts';
import { adzunaAdapter } from './adzuna.ts';
import { ashbyAdapter } from './ashby.ts';
import { greenhouseAdapter } from './greenhouse.ts';
import { jsearchAdapter } from './jsearch.ts';
import { leverAdapter } from './lever.ts';
import type { IngestionAdapter, RawPosting } from './types.ts';
import { pathToFileURL } from 'node:url';

const DEFAULT_ADAPTERS: IngestionAdapter[] = [jsearchAdapter, adzunaAdapter, greenhouseAdapter, leverAdapter, ashbyAdapter];

export type IngestionSummary = { source: string; fetched: number; upserted: number; failed: string | null };

export async function runIngestion(adapters: IngestionAdapter[] = DEFAULT_ADAPTERS): Promise<IngestionSummary[]> {
  const summaries: IngestionSummary[] = [];
  for (const adapter of adapters) {
    try {
      const raw = await adapter.fetchPostings();
      const upserted = await upsertPostings(raw);
      summaries.push({ source: adapter.name, fetched: raw.length, upserted, failed: null });
    } catch (error) {
      summaries.push({
        source: adapter.name,
        fetched: 0,
        upserted: 0,
        failed: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summaries;
}

async function upsertPostings(raw: RawPosting[]): Promise<number> {
  if (raw.length === 0) return 0;
  const rows = await getDb()
    .insert(postings)
    .values(
      raw.map((posting) => ({
        title: posting.title,
        company: posting.company,
        locations: posting.locations && posting.locations.length > 0 ? posting.locations : null,
        country: posting.country ?? null,
        workplace: posting.workplace ?? null,
        employment: posting.employment ?? null,
        postedAt: posting.postedAt ?? null,
        url: posting.url,
        source: posting.source,
      })),
    )
    .onConflictDoUpdate({
      target: postings.url,
      set: {
        title: sqlOp`excluded.title`,
        company: sqlOp`excluded.company`,
        locations: sqlOp`excluded.locations`,
        country: sqlOp`excluded.country`,
        workplace: sqlOp`excluded.workplace`,
        employment: sqlOp`excluded.employment`,
        postedAt: sqlOp`excluded.posted_at`,
        source: sqlOp`excluded.source`,
      },
    })
    .returning({ id: postings.id });
  return rows.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const summary = await runIngestion();
  console.log(JSON.stringify(summary, null, 2));
  // getDb()'s connection pool otherwise keeps the event loop alive forever;
  // this CLI entrypoint is the only caller that should ever close it (the
  // cron route imports runIngestion() directly and relies on the pool
  // surviving across warm invocations, so it must never hit this line).
  await closeDb();
}

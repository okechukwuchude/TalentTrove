import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb } from './db.ts';
import { applications, judgments, postings, tailoredResumes } from '../db/schema.ts';
import { VERDICTS, rankOf } from '@talenttrove/shared';
import type { PostingJson } from './tabs-db.ts';

export type ApplicationQueueRow = PostingJson & { cover_letter: string };

const APPLY_MIN_VERDICT = 'fair';
const APPLY_VERDICTS = VERDICTS.filter((verdict) => rankOf(verdict) >= rankOf(APPLY_MIN_VERDICT));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

type PostingRow = typeof postings.$inferSelect;

function toQueueRow(row: PostingRow, verdict: string, reasoning: string, coverLetter: string): ApplicationQueueRow {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    ...(row.locations && row.locations.length > 0 ? { locations: row.locations } : {}),
    ...(row.workplace ? { workplace: row.workplace } : {}),
    ...(row.employment ? { employment: row.employment } : {}),
    posted_at: row.postedAt ? row.postedAt.toISOString() : null,
    url: row.url,
    verdict,
    verdict_reasoning: reasoning,
    has_tailored_resume: true,
    cover_letter: coverLetter,
  };
}

function encodeCursor(generatedAt: Date, postingId: string): string {
  return Buffer.from(`${generatedAt.toISOString()}|${postingId}`).toString('base64url');
}

function decodeCursor(cursor: string): { generatedAt: Date; postingId: string } | null {
  try {
    const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (parts.length !== 2) return null;
    const [generatedAtRaw, postingId] = parts;
    if (!generatedAtRaw || !postingId || !isUuid(postingId)) return null;
    const generatedAt = new Date(generatedAtRaw);
    if (Number.isNaN(generatedAt.getTime())) return null;
    return { generatedAt, postingId };
  } catch {
    return null;
  }
}

export async function getApplicationQueue(
  userId: string,
  limit: number,
  cursor: string | null,
): Promise<{ rows: ApplicationQueueRow[]; cursor: string | null }> {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return { rows: [], cursor: null };

  /**
   * `tailored_resumes.generated_at` is stored at full (microsecond) Postgres
   * precision, but a cursor round-trips through a JS `Date` — which can only
   * hold millisecond precision — via `toISOString()`. Comparing the raw
   * column against a cursor built from that truncated `Date` made the last
   * row of a page re-match `gt(generatedAt, cursor)` on the next page (its
   * real value has microseconds beyond what the cursor could carry), so the
   * boundary row leaked into the following page. Truncating the column to
   * milliseconds with `date_trunc` before ordering/selecting/comparing puts
   * both sides of every comparison at the same precision the cursor can
   * actually represent.
   */
  const generatedAtMs = sql<Date>`date_trunc('milliseconds', ${tailoredResumes.generatedAt})`.mapWith(
    (value: string | Date) => new Date(value),
  );

  const conditions = [isNull(applications.id)];
  if (decoded) {
    // Bound as text-then-cast, not a `Date` object: `generatedAtMs` is a raw
    // `sql` expression rather than a real drizzle `Column`, so drizzle has no
    // column metadata to serialize a `Date` bind parameter through — passing
    // one directly makes the underlying `postgres` driver throw at bind time.
    const cursorGeneratedAt = decoded.generatedAt.toISOString();
    conditions.push(
      or(
        sql`${generatedAtMs} > ${cursorGeneratedAt}::timestamptz`,
        and(sql`${generatedAtMs} = ${cursorGeneratedAt}::timestamptz`, gt(postings.id, decoded.postingId))!,
      )!,
    );
  }

  const fetched = await getDb()
    .select({
      posting: postings,
      verdict: judgments.verdict,
      reasoning: judgments.reasoning,
      coverLetter: tailoredResumes.coverLetter,
      generatedAt: generatedAtMs,
    })
    .from(postings)
    .innerJoin(
      judgments,
      and(eq(judgments.postingId, postings.id), eq(judgments.userId, userId), inArray(judgments.verdict, APPLY_VERDICTS)),
    )
    .innerJoin(tailoredResumes, and(eq(tailoredResumes.postingId, postings.id), eq(tailoredResumes.userId, userId)))
    .leftJoin(applications, and(eq(applications.postingId, postings.id), eq(applications.userId, userId)))
    .where(and(...conditions))
    .orderBy(asc(generatedAtMs), asc(postings.id))
    .limit(limit + 1);

  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;

  const rows = page.map((entry) => toQueueRow(entry.posting, entry.verdict, entry.reasoning, entry.coverLetter));

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.generatedAt, last.posting.id) : null;

  return { rows, cursor: nextCursor };
}

export async function markApplied(userId: string, postingId: string): Promise<void> {
  await getDb().insert(applications).values({ userId, postingId }).onConflictDoNothing();
}

export async function unmarkApplied(userId: string, postingId: string): Promise<void> {
  await getDb()
    .delete(applications)
    .where(and(eq(applications.userId, userId), eq(applications.postingId, postingId)));
}

import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from './db.ts';
import { postings } from '../db/schema.ts';
import type { PostingJson } from './tabs-db.ts';

export type SearchFilters = {
  q?: string;
  country?: string;
  workplace?: string;
  employment?: string;
  postedAfter?: string;
  company?: string[];
};

export type CompanyRow = { id: string; name: string; posting_count: number };

type PostingRow = typeof postings.$inferSelect;

function toPostingJson(row: PostingRow): PostingJson {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    ...(row.locations && row.locations.length > 0 ? { locations: row.locations } : {}),
    ...(row.workplace ? { workplace: row.workplace } : {}),
    ...(row.employment ? { employment: row.employment } : {}),
    posted_at: row.postedAt ? row.postedAt.toISOString() : null,
    url: row.url,
  };
}

function encodeCursor(sortKey: string, id: string): string {
  return Buffer.from(`${sortKey}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { sortKey: string; id: string } | null {
  try {
    const [sortKey, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!sortKey || !id) return null;
    return { sortKey, id };
  } catch {
    return null;
  }
}

export async function searchPostings(
  filters: SearchFilters,
  limit: number,
  cursor: string | null,
): Promise<{ rows: PostingJson[]; cursor: string | null }> {
  const hasQuery = Boolean(filters.q && filters.q.trim());
  const q = filters.q?.trim() ?? '';
  // NOTE (deviation from brief): only build a real `ts_rank(...,
  // plainto_tsquery(...))` expression when there is an actual query — it is
  // always selected as a column (see `.select({ row, rank: rankExpr })`
  // below), so with the brief's unconditional version, every no-query call
  // ran `plainto_tsquery('english', '')` on every row and postgres emitted a
  // `text-search query doesn't contain lexemes: ""` NOTICE per query,
  // spamming stdout in tests and (per this repo's own convention of
  // pristine, piggable stdout/stderr) in the CLI/server too. A cheap
  // constant keeps the shared `{ row, rank }` shape without ever invoking
  // `plainto_tsquery` when it isn't needed.
  const rankExpr = hasQuery
    ? sql<number>`ts_rank(to_tsvector('english', ${postings.title} || ' ' || ${postings.company}), plainto_tsquery('english', ${q}))`
    : sql<number>`0`;

  const conditions = [];
  if (hasQuery) {
    conditions.push(
      sql`to_tsvector('english', ${postings.title} || ' ' || ${postings.company}) @@ plainto_tsquery('english', ${q})`,
    );
  }
  if (filters.country) {
    conditions.push(ilike(postings.country, `%${filters.country}%`));
  }
  if (filters.workplace) {
    conditions.push(eq(postings.workplace, filters.workplace));
  }
  if (filters.employment) {
    conditions.push(eq(postings.employment, filters.employment));
  }
  if (filters.postedAfter) {
    // NOTE (deviation from brief): the brief's version interpolated a raw JS
    // `Date` into a `sql` template fragment (`sql\`${postings.postedAt} >=
    // ${new Date(...)}\``). drizzle's postgres-js driver runs queries through
    // `client.unsafe(query, params)`, which sends interpolated `sql`-tag
    // values to the wire mostly as-is — it does NOT run them through a
    // column's `mapToDriverValue` encoder the way `eq`/`gte`/etc. do. A raw
    // `Date` object reaches postgres.js's low-level `str()` writer, which
    // calls `Buffer.byteLength(x)` and throws
    // "argument must be of type string ... Received an instance of Date".
    // Using the typed `gte()` helper instead routes the value through the
    // column's encoder (Date -> ISO string) before it ever becomes a bind
    // parameter, so this fixes a real runtime crash, not a style nit.
    conditions.push(gte(postings.postedAt, new Date(filters.postedAfter)));
  }
  if (filters.company && filters.company.length > 0) {
    // NOTE (deviation from brief): the brief's version interpolated the
    // whole `filters.company` array into a `sql` template as
    // `= ANY(${filters.company})`. drizzle's `sql` tag treats any
    // interpolated JS array as an IN-style list — it rewrites it to
    // `(elem1, elem2, ...)` with one bind param per element (see
    // `buildQueryFromSourceParams`'s `Array.isArray(chunk)` branch) — rather
    // than binding the array itself as a single Postgres array-typed
    // parameter. With one company that collapsed to `ANY(($1))` bound to the
    // bare string 'Acme', and postgres itself then failed with "malformed
    // array literal" because `ANY(...)` expects an array value. `inArray()`
    // is drizzle's purpose-built helper for exactly this "column in a list"
    // case and produces correct SQL for one or many values.
    conditions.push(inArray(postings.company, filters.company));
  }

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return { rows: [], cursor: null };

  if (decoded) {
    if (hasQuery) {
      const decodedRank = Number(decoded.sortKey);
      conditions.push(
        or(sql`${rankExpr} < ${decodedRank}`, and(sql`${rankExpr} = ${decodedRank}`, gt(postings.id, decoded.id))!)!,
      );
    } else {
      const decodedDate = new Date(decoded.sortKey);
      // NOTE (deviation from brief): same raw-Date-in-`sql`-template bug as
      // the `postedAfter` filter above (see comment there) — the brief's
      // `sql\`${postings.postedAt} < ${decodedDate} OR ...\`` crashed
      // postgres.js. Rebuilt with `lt`/`isNull` so the Date is routed
      // through the column's encoder.
      conditions.push(
        or(
          or(lt(postings.postedAt, decodedDate), isNull(postings.postedAt))!,
          and(eq(postings.postedAt, decodedDate), gt(postings.id, decoded.id))!,
        )!,
      );
    }
  }

  const fetched = await getDb()
    .select({ row: postings, rank: rankExpr })
    .from(postings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      hasQuery ? desc(rankExpr) : sql`${postings.postedAt} desc nulls last`,
      asc(postings.id),
    )
    .limit(limit + 1);

  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;

  const rows = page.map((entry) => toPostingJson(entry.row));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(hasQuery ? String(last.rank) : last.row.postedAt ? last.row.postedAt.toISOString() : '', last.row.id)
      : null;

  return { rows, cursor: nextCursor };
}

export async function searchCompanies(query: string): Promise<CompanyRow[]> {
  if (query.trim().length < 2) return [];
  const rows = await getDb()
    .select({ name: postings.company, postingCount: sql<number>`count(*)::int` })
    .from(postings)
    .where(ilike(postings.company, `%${query.trim()}%`))
    .groupBy(postings.company)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  return rows.map((row) => ({ id: row.name, name: row.name, posting_count: row.postingCount }));
}

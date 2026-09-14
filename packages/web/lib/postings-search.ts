import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from './db.ts';
import { postings, judgments } from '../db/schema.ts';
import { normalizeCountry } from './ingestion/shared.ts';
import type { PostingJson } from './tabs-db.ts';

export type SearchFilters = {
  q?: string;
  country?: string;
  workplace?: string;
  employment?: string;
  postedAfter?: string;
  company?: string[];
  unjudged?: boolean;
};

export type CompanyRow = { id: string; name: string; posting_count: number };

type PostingRow = typeof postings.$inferSelect;

function toPostingJson(row: PostingRow, judgment?: { verdict: string; reasoning: string }): PostingJson {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    ...(row.locations && row.locations.length > 0 ? { locations: row.locations } : {}),
    ...(row.workplace ? { workplace: row.workplace } : {}),
    ...(row.employment ? { employment: row.employment } : {}),
    posted_at: row.postedAt ? row.postedAt.toISOString() : null,
    url: row.url,
    ...(judgment ? { verdict: judgment.verdict, verdict_reasoning: judgment.reasoning } : {}),
  };
}

function encodeCursor(sortKey: string, id: string): string {
  return Buffer.from(`${sortKey}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { sortKey: string; id: string } | null {
  try {
    // NOTE (fix, post-review): the sort-key half of the cursor is legitimately
    // the empty string when the last row on a page has a NULL `posted_at` (see
    // `encodeCursor`'s call site below) — `posted_at desc nulls last` means
    // rows with no posted date are real, expected results, not an edge case.
    // The original version validated the decoded cursor by JS truthiness
    // (`!sortKey || !id`), which treats a validly-encoded empty sort-key as
    // malformed input and silently truncates pagination right at that
    // boundary (page N+1 comes back empty with `cursor: null` even though
    // there are more, all-null-`posted_at`, rows left). Validate by *shape*
    // instead — the encoding always produces exactly one `|` separator, so
    // `split('|')` must produce exactly two parts — and only require the `id`
    // half to be non-empty (a posting id is always a non-empty uuid; the
    // sort-key half is allowed to be empty).
    const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (parts.length !== 2) return null;
    const [sortKey, id] = parts;
    if (!id) return null;
    return { sortKey: sortKey!, id };
  } catch {
    return null;
  }
}

export async function searchPostings(
  userId: string,
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
    // NOTE (fix, post-review): every adapter now stores `country` through
    // `normalizeCountry` (one canonical spelling per country — see that
    // function's doc comment), but this filter's value is still whatever a
    // person typed into a plain text box. Routing it through the same
    // `normalizeCountry` before comparing means "us"/"USA"/"United States"
    // all resolve to the one spelling actually stored, so an *exact*
    // (anchored, case-insensitive) match works without requiring the exact
    // canonical spelling — and, unlike the previous unanchored
    // `ilike('%...%')`, "us" no longer substring-matches "Australia" or
    // "Belarus". A value that doesn't normalize to a country (e.g. someone
    // typing "remote" into the country box) is treated as no filter at all,
    // consistent with this codebase's "can't confidently map, omit rather
    // than guess" convention — filtering to zero results on a nonsensical
    // input would be a worse outcome than ignoring it.
    const normalizedCountry = normalizeCountry(filters.country);
    if (normalizedCountry) {
      conditions.push(ilike(postings.country, normalizedCountry));
    }
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
    //
    // A malformed `postedAfter` string (`new Date(...)` producing an
    // Invalid Date) is guarded here rather than left to throw — the value
    // ultimately comes from an HTTP query param (wired up in a later task),
    // so treating "can't parse this as a date" as "no filter" is cheap and
    // safe; it is not a substitute for proper request validation upstream.
    const postedAfterDate = new Date(filters.postedAfter);
    if (!Number.isNaN(postedAfterDate.getTime())) {
      conditions.push(gte(postings.postedAt, postedAfterDate));
    }
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
  if (filters.unjudged) {
    conditions.push(isNull(judgments.id));
  }

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return { rows: [], cursor: null };

  if (decoded) {
    if (hasQuery) {
      const decodedRank = Number(decoded.sortKey);
      conditions.push(
        or(sql`${rankExpr} < ${decodedRank}`, and(sql`${rankExpr} = ${decodedRank}`, gt(postings.id, decoded.id))!)!,
      );
    } else if (decoded.sortKey === '') {
      // NOTE (fix, post-review): the previous page's last row had a NULL
      // `posted_at` (encoded as the empty-string sentinel — see
      // `encodeCursor`'s call site below). Because the ordering is
      // `posted_at desc nulls last`, every NULL-dated row sorts strictly
      // after every non-NULL-dated row — so once a page's last row is NULL,
      // every row that came before it in the full ordering (all non-NULL
      // rows, plus any NULL rows already returned) has necessarily already
      // been returned on this or an earlier page. The remaining rows are
      // exactly the other NULL-dated rows, tie-broken by `id` ascending like
      // every other page. (`new Date('')` is an Invalid Date — feeding it to
      // `lt`/`eq` below would either crash or silently match nothing, so
      // this case must be handled separately rather than falling into the
      // generic branch.)
      conditions.push(and(isNull(postings.postedAt), gt(postings.id, decoded.id))!);
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
    .select({ row: postings, rank: rankExpr, verdict: judgments.verdict, reasoning: judgments.reasoning })
    .from(postings)
    .leftJoin(judgments, and(eq(judgments.postingId, postings.id), eq(judgments.userId, userId)))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      hasQuery ? desc(rankExpr) : sql`${postings.postedAt} desc nulls last`,
      asc(postings.id),
    )
    .limit(limit + 1);

  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;

  const rows = page.map((entry) =>
    toPostingJson(entry.row, entry.verdict ? { verdict: entry.verdict, reasoning: entry.reasoning! } : undefined),
  );
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

import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './db.ts';
import { postings, tabItems, tabs, judgments, tailoredResumes } from '../db/schema.ts';

const DEFAULT_PAGE_LIMIT = 20;

export type TabSummary = { name: string; description: string | null; items: number };

export type PostingJson = {
  id: string;
  title: string;
  company: string;
  locations?: string[];
  workplace?: string;
  employment?: string;
  posted_at: string | null;
  url: string;
  item_id?: string;
  verdict?: string;
  verdict_reasoning?: string;
  has_tailored_resume?: boolean;
};

type PostingRow = typeof postings.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `postings.id` and `tab_items.id` are Postgres `uuid` columns — comparing
 * one to an arbitrary string (a stale/forged id from a client) makes
 * Postgres throw "invalid input syntax for type uuid", not return no rows.
 * Every id that reaches a `uuid`-typed WHERE/IN clause below is filtered
 * through this first, so a bogus id becomes "unknown"/"not found" instead
 * of a 500.
 */
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function toPostingJson(
  row: PostingRow,
  itemId?: string,
  judgment?: { verdict: string; reasoning: string },
  hasTailoredResume?: boolean,
): PostingJson {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    ...(row.locations && row.locations.length > 0 ? { locations: row.locations } : {}),
    ...(row.workplace ? { workplace: row.workplace } : {}),
    ...(row.employment ? { employment: row.employment } : {}),
    posted_at: row.postedAt ? row.postedAt.toISOString() : null,
    url: row.url,
    ...(itemId ? { item_id: itemId } : {}),
    ...(judgment ? { verdict: judgment.verdict, verdict_reasoning: judgment.reasoning } : {}),
    ...(hasTailoredResume ? { has_tailored_resume: true } : {}),
  };
}

function encodeCursor(addedAt: Date, itemId: string): string {
  return Buffer.from(`${addedAt.toISOString()}|${itemId}`).toString('base64url');
}

function decodeCursor(cursor: string): { addedAt: Date; itemId: string } | null {
  try {
    const [addedAtRaw, itemId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!addedAtRaw || !itemId || !isUuid(itemId)) return null;
    const addedAt = new Date(addedAtRaw);
    if (Number.isNaN(addedAt.getTime())) return null;
    return { addedAt, itemId };
  } catch {
    return null;
  }
}

async function tabBelongsToUser(userId: string, tabId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: tabs.id })
    .from(tabs)
    .where(and(eq(tabs.id, tabId), eq(tabs.userId, userId)));
  return Boolean(row);
}

export async function listTabs(userId: string): Promise<TabSummary[]> {
  return getDb()
    .select({
      name: tabs.name,
      description: tabs.description,
      items: sql<number>`count(${tabItems.id})::int`,
    })
    .from(tabs)
    .leftJoin(tabItems, eq(tabItems.tabId, tabs.id))
    .where(eq(tabs.userId, userId))
    .groupBy(tabs.id)
    .orderBy(desc(tabs.createdAt));
}

export async function findTabByName(
  userId: string,
  name: string,
): Promise<{ id: string; name: string; description: string | null } | null> {
  const [row] = await getDb()
    .select({ id: tabs.id, name: tabs.name, description: tabs.description })
    .from(tabs)
    .where(and(eq(tabs.userId, userId), eq(tabs.name, name)));
  return row ?? null;
}

export async function createTab(userId: string, name: string, description: string | null): Promise<TabSummary> {
  const [row] = await getDb()
    .insert(tabs)
    .values({ userId, name, description })
    .returning({ name: tabs.name, description: tabs.description });
  return { ...row!, items: 0 };
}

export async function renameTab(userId: string, tabId: string, to: string): Promise<void> {
  await getDb()
    .update(tabs)
    .set({ name: to })
    .where(and(eq(tabs.id, tabId), eq(tabs.userId, userId)));
}

export async function deleteTab(userId: string, tabId: string): Promise<void> {
  await getDb()
    .delete(tabs)
    .where(and(eq(tabs.id, tabId), eq(tabs.userId, userId)));
}

export async function getTabContents(
  userId: string,
  tabId: string,
  limit: number,
  cursor: string | null,
): Promise<{ rows: PostingJson[]; cursor: string | null; noLongerPresent: { postingId: string; itemId: string }[] } | null> {
  if (!(await tabBelongsToUser(userId, tabId))) return null;

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return { rows: [], cursor: null, noLongerPresent: [] };

  const conditions = [eq(tabItems.tabId, tabId)];
  if (decoded) {
    conditions.push(
      or(
        gt(tabItems.addedAt, decoded.addedAt),
        and(eq(tabItems.addedAt, decoded.addedAt), gt(tabItems.id, decoded.itemId))!,
      )!,
    );
  }

  const fetched = await getDb()
    .select({
      itemId: tabItems.id,
      addedAt: tabItems.addedAt,
      postingId: tabItems.postingId,
      posting: postings,
      verdict: judgments.verdict,
      reasoning: judgments.reasoning,
      tailoredResumeId: tailoredResumes.id,
    })
    .from(tabItems)
    .leftJoin(postings, eq(postings.id, tabItems.postingId))
    .leftJoin(judgments, and(eq(judgments.postingId, tabItems.postingId), eq(judgments.userId, userId)))
    .leftJoin(tailoredResumes, and(eq(tailoredResumes.postingId, tabItems.postingId), eq(tailoredResumes.userId, userId)))
    .where(and(...conditions))
    .orderBy(asc(tabItems.addedAt), asc(tabItems.id))
    .limit(limit + 1);

  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;

  const rows: PostingJson[] = [];
  const noLongerPresent: { postingId: string; itemId: string }[] = [];
  for (const row of page) {
    if (row.posting) {
      rows.push(
        toPostingJson(
          row.posting,
          row.itemId,
          row.verdict ? { verdict: row.verdict, reasoning: row.reasoning! } : undefined,
          Boolean(row.tailoredResumeId),
        ),
      );
    } else {
      noLongerPresent.push({ postingId: row.postingId, itemId: row.itemId });
    }
  }

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.addedAt, last.itemId) : null;

  return { rows, cursor: nextCursor, noLongerPresent };
}

export async function addPostingsToTab(
  userId: string,
  tabId: string,
  postingIds: string[],
): Promise<{ rows: PostingJson[]; alreadyPresent: string[]; unknown: string[]; covered: number } | null> {
  if (!(await tabBelongsToUser(userId, tabId))) return null;

  const candidateIds = postingIds.filter(isUuid);

  const existingPostings = candidateIds.length > 0
    ? await getDb().select().from(postings).where(inArray(postings.id, candidateIds))
    : [];
  const existingIds = new Set(existingPostings.map((row) => row.id));
  const unknown = postingIds.filter((id) => !existingIds.has(id));

  const existingItems = candidateIds.length > 0
    ? await getDb()
        .select({ postingId: tabItems.postingId })
        .from(tabItems)
        .where(and(eq(tabItems.tabId, tabId), inArray(tabItems.postingId, candidateIds)))
    : [];
  const alreadyPresentIds = new Set(existingItems.map((row) => row.postingId));
  const alreadyPresent = postingIds.filter((id) => existingIds.has(id) && alreadyPresentIds.has(id));

  const toInsertIds = postingIds.filter((id) => existingIds.has(id) && !alreadyPresentIds.has(id));

  const inserted = toInsertIds.length > 0
    ? await getDb()
        .insert(tabItems)
        .values(toInsertIds.map((postingId) => ({ tabId, postingId })))
        .onConflictDoNothing()
        .returning({ id: tabItems.id, postingId: tabItems.postingId })
    : [];

  const postingById = new Map(existingPostings.map((row) => [row.id, row]));
  const rows = inserted
    .map((item) => {
      const posting = postingById.get(item.postingId);
      return posting ? toPostingJson(posting, item.id) : null;
    })
    .filter((row): row is PostingJson => row !== null);

  return { rows, alreadyPresent, unknown, covered: inserted.length };
}

export async function removeFromTab(
  userId: string,
  tabId: string,
  itemIds: string[],
): Promise<{ rows: PostingJson[]; notFound: string[]; covered: number } | null> {
  if (!(await tabBelongsToUser(userId, tabId))) return null;

  const candidateIds = itemIds.filter(isUuid);
  const existing = candidateIds.length > 0
    ? await getDb()
        .select({ id: tabItems.id })
        .from(tabItems)
        .where(and(eq(tabItems.tabId, tabId), inArray(tabItems.id, candidateIds)))
    : [];
  const foundIds = existing.map((row) => row.id);
  const notFound = itemIds.filter((id) => !foundIds.includes(id));

  if (foundIds.length > 0) {
    await getDb()
      .delete(tabItems)
      .where(and(eq(tabItems.tabId, tabId), inArray(tabItems.id, foundIds)));
  }

  const remaining = await getTabContents(userId, tabId, DEFAULT_PAGE_LIMIT, null);

  return { rows: remaining?.rows ?? [], notFound, covered: foundIds.length };
}

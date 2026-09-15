import { and, asc, eq } from 'drizzle-orm';
import { getDb } from './db.ts';
import { routines } from '../db/schema.ts';
import type { RoutineFilters } from './postings-search.ts';

export type RoutineSummary = {
  name: string;
  filters: RoutineFilters;
  judge_prompt: string | null;
  destination_tab: string | null;
};

type RoutineRow = typeof routines.$inferSelect;

function toSummary(row: RoutineRow): RoutineSummary {
  return {
    name: row.name,
    filters: row.filters as RoutineFilters,
    judge_prompt: row.judgePrompt,
    destination_tab: row.destinationTab,
  };
}

export async function listRoutines(userId: string): Promise<RoutineSummary[]> {
  const rows = await getDb().select().from(routines).where(eq(routines.userId, userId)).orderBy(asc(routines.createdAt));
  return rows.map(toSummary);
}

export async function createRoutine(
  userId: string,
  name: string,
  filters: RoutineFilters,
  judgePrompt: string | null,
  destinationTab: string | null,
): Promise<RoutineSummary> {
  const [row] = await getDb()
    .insert(routines)
    .values({ userId, name, filters, judgePrompt, destinationTab })
    .returning();
  return toSummary(row!);
}

export async function findRoutineByName(userId: string, name: string): Promise<RoutineSummary | null> {
  const [row] = await getDb()
    .select()
    .from(routines)
    .where(and(eq(routines.userId, userId), eq(routines.name, name)));
  return row ? toSummary(row) : null;
}

export async function updateRoutine(
  userId: string,
  name: string,
  updates: { filters?: RoutineFilters; judgePrompt?: string | null; destinationTab?: string | null },
): Promise<RoutineSummary | null> {
  const set: Partial<typeof routines.$inferInsert> = {};
  if ('filters' in updates) set.filters = updates.filters;
  if ('judgePrompt' in updates) set.judgePrompt = updates.judgePrompt;
  if ('destinationTab' in updates) set.destinationTab = updates.destinationTab;
  if (Object.keys(set).length === 0) return findRoutineByName(userId, name);

  const [row] = await getDb()
    .update(routines)
    .set(set)
    .where(and(eq(routines.userId, userId), eq(routines.name, name)))
    .returning();
  return row ? toSummary(row) : null;
}

export async function deleteRoutine(userId: string, name: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(routines)
    .where(and(eq(routines.userId, userId), eq(routines.name, name)))
    .returning({ id: routines.id });
  return deleted.length > 0;
}

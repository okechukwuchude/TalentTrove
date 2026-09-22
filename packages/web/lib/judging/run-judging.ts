import { and, asc, eq, isNull } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { closeDb, getDb } from '../db.ts';
import { judgments, postings, profileDocuments, users } from '../../db/schema.ts';
import { callJudgeModel } from './openrouter.ts';
import { parseResumePdf } from '../pdf.ts';
import { DEFAULT_JUDGE_PROMPT, JUDGE_PROMPT_NAME, QUICK_JUDGE_PROMPT_NAME, RESERVED_NAMES, VERDICTS, rankOf } from '@talenttrove/shared';
import { listRoutines } from '../routines-db.ts';
import { buildSearchConditions, type RoutineFilters } from '../postings-search.ts';
import { findTabByName, createTab, addPostingsToTab } from '../tabs-db.ts';

export type JudgingSummary = { userId: string; judged: number; failed: number };

type ProfileDocRow = typeof profileDocuments.$inferSelect;
type PostingRow = typeof postings.$inferSelect;

const DEFAULT_BATCH_SIZE = 25;

/**
 * How long runJudging() is willing to keep starting new model calls before
 * it stops and returns whatever it's finished so far. Set well under the
 * cron route's `maxDuration = 300` (see app/api/cron/judge-postings/route.ts)
 * so the function always has time to finish its current insert and respond
 * normally, rather than getting killed mid-request by Vercel's
 * FUNCTION_INVOCATION_TIMEOUT — which returns nothing to the caller and
 * drops whatever candidate was in flight. Anything left over when the budget
 * runs out is picked up by the next scheduled run, since the candidate
 * query already skips postings that already have a judgment.
 */
export const TIME_BUDGET_MS = 270_000;

const ROUTINE_MIN_VERDICT = 'fair';
const ROUTINE_FILE_VERDICTS = VERDICTS.filter((verdict) => rankOf(verdict) >= rankOf(ROUTINE_MIN_VERDICT));

/**
 * Reserved names that must never appear as a labelled document in the text
 * sent to the model: the judge-prompt names (their text is sent once, as the
 * instructions, not as profile content — see RESERVED_NAMES' doc comment)
 * and 'resume' (handled specially above, parsed from its PDF bytes rather
 * than included as plain text). Derived from RESERVED_NAMES, rather than a
 * standalone hardcoded list, so this set can only ever name documents the
 * shared registry actually reserves.
 */
const PROFILE_TEXT_SKIP_NAMES: ReadonlySet<string> = new Set(
  [JUDGE_PROMPT_NAME, QUICK_JUDGE_PROMPT_NAME, 'resume'].filter((name) =>
    Object.prototype.hasOwnProperty.call(RESERVED_NAMES, name),
  ),
);

function batchSize(): number {
  const raw = process.env.JUDGE_BATCH_SIZE;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

function resolveJudgePrompt(docs: ProfileDocRow[]): string {
  const stored = docs.find((doc) => doc.name === JUDGE_PROMPT_NAME);
  const text = stored?.textContent?.trim();
  return text ? stored!.textContent! : DEFAULT_JUDGE_PROMPT;
}

async function buildProfileText(docs: ProfileDocRow[]): Promise<string> {
  const sections: string[] = [];
  for (const doc of docs) {
    if (doc.name === 'resume') {
      if (!doc.fileBytes) continue;
      try {
        const parsed = await parseResumePdf(doc.fileBytes);
        if (parsed.text) sections.push(`resume:\n${parsed.text}`);
      } catch {
        // Stored bytes were already validated as a PDF at upload time; if
        // parsing fails anyway, treat this account as having no resume
        // rather than aborting the whole run over one document.
      }
      continue;
    }
    if (PROFILE_TEXT_SKIP_NAMES.has(doc.name)) continue;
    if (doc.textContent && doc.textContent.trim()) sections.push(`${doc.name}:\n${doc.textContent}`);
  }
  return sections.join('\n\n');
}

function buildPostingText(posting: PostingRow): string {
  const lines = [
    `title: ${posting.title}`,
    `company: ${posting.company}`,
    ...(posting.locations && posting.locations.length > 0 ? [`locations: ${posting.locations.join(', ')}`] : []),
    ...(posting.workplace ? [`workplace: ${posting.workplace}`] : []),
    ...(posting.employment ? [`employment: ${posting.employment}`] : []),
    ...(posting.postedAt ? [`posted: ${posting.postedAt.toISOString()}`] : []),
    `url: ${posting.url}`,
    '',
    'description:',
    posting.description ?? 'not available for this posting',
  ];
  return lines.join('\n');
}

export async function runJudging(
  callModel: typeof callJudgeModel = callJudgeModel,
  now: () => number = Date.now,
): Promise<JudgingSummary[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.JUDGE_MODEL;
  if (!apiKey || !model) return [];

  const limit = batchSize();
  const summaries: JudgingSummary[] = [];
  const accounts = await getDb().select({ id: users.id }).from(users);
  const deadline = now() + TIME_BUDGET_MS;

  for (const account of accounts) {
    if (now() >= deadline) break;
    try {
      const docs = await getDb().select().from(profileDocuments).where(eq(profileDocuments.userId, account.id));
      const profileText = await buildProfileText(docs);
      // A row existing under a substance name isn't enough — an empty
      // background string or a resume PDF with no extractable text both
      // produce no real profileText, and judging against nothing produces a
      // verdict with no basis (and, since re-judging is out of scope, that
      // bad verdict is permanent). Gate on the text actually having content.
      if (!profileText.trim()) continue;

      const accountRoutines = await listRoutines(account.id);

      if (accountRoutines.length > 0) {
        let judged = 0;
        let failed = 0;
        for (const routine of accountRoutines) {
          if (now() >= deadline) break;
          try {
            const routineFilters = routine.filters as RoutineFilters;
            const conditions = buildSearchConditions(routineFilters);
            const candidates = await getDb()
              .select({ posting: postings })
              .from(postings)
              .leftJoin(judgments, and(eq(judgments.postingId, postings.id), eq(judgments.userId, account.id)))
              .where(and(isNull(judgments.id), ...conditions))
              .orderBy(asc(postings.createdAt))
              .limit(limit);

            const systemPrompt = routine.judge_prompt?.trim() ? routine.judge_prompt : DEFAULT_JUDGE_PROMPT;

            for (const { posting } of candidates) {
              if (now() >= deadline) break;
              try {
                const result = await callModel(apiKey, {
                  model,
                  systemPrompt,
                  postingText: buildPostingText(posting),
                  profileText,
                });
                if ('error' in result) {
                  console.error(`judge: user ${account.id} routine ${routine.name} posting ${posting.id} failed: ${result.error}`);
                  failed += 1;
                  continue;
                }
                await getDb()
                  .insert(judgments)
                  .values({ userId: account.id, postingId: posting.id, verdict: result.verdict, reasoning: result.reasoning, model })
                  .onConflictDoNothing();
                judged += 1;

                if (routine.destination_tab && ROUTINE_FILE_VERDICTS.includes(result.verdict as (typeof VERDICTS)[number])) {
                  let tab = await findTabByName(account.id, routine.destination_tab);
                  if (!tab) {
                    await createTab(account.id, routine.destination_tab, null);
                    tab = await findTabByName(account.id, routine.destination_tab);
                  }
                  if (tab) await addPostingsToTab(account.id, tab.id, [posting.id]);
                }
              } catch (error) {
                console.error(`judge: user ${account.id} routine ${routine.name} posting ${posting.id} threw`, error);
                failed += 1;
              }
            }
          } catch (error) {
            console.error(`judge: user ${account.id} routine ${routine.name} threw`, error);
            failed += 1;
          }
        }
        summaries.push({ userId: account.id, judged, failed });
        continue;
      }

      const candidates = await getDb()
        .select({ posting: postings })
        .from(postings)
        .leftJoin(judgments, and(eq(judgments.postingId, postings.id), eq(judgments.userId, account.id)))
        .where(isNull(judgments.id))
        .orderBy(asc(postings.createdAt))
        .limit(limit);
      if (candidates.length === 0) continue;

      const systemPrompt = resolveJudgePrompt(docs);

      let judged = 0;
      let failed = 0;
      for (const { posting } of candidates) {
        if (now() >= deadline) break;
        try {
          const result = await callModel(apiKey, {
            model,
            systemPrompt,
            postingText: buildPostingText(posting),
            profileText,
          });
          if ('error' in result) {
            console.error(`judge: user ${account.id} posting ${posting.id} failed: ${result.error}`);
            failed += 1;
            continue;
          }
          await getDb()
            .insert(judgments)
            .values({ userId: account.id, postingId: posting.id, verdict: result.verdict, reasoning: result.reasoning, model })
            .onConflictDoNothing();
          judged += 1;
        } catch (error) {
          console.error(`judge: user ${account.id} posting ${posting.id} threw`, error);
          failed += 1;
        }
      }
      summaries.push({ userId: account.id, judged, failed });
    } catch (error) {
      // One account's failure (a transient DB error on its candidates query,
      // a resume that throws in a way buildProfileText's own try/catch
      // doesn't anticipate) must not abort every other account's run.
      console.error(`judge: user ${account.id} threw`, error);
    }
  }
  return summaries;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const summary = await runJudging();
  console.log(JSON.stringify(summary, null, 2));
  await closeDb();
}

import { and, asc, eq, isNull } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { closeDb, getDb } from '../db.ts';
import { judgments, postings, profileDocuments, users } from '../../db/schema.ts';
import { callJudgeModel } from './openrouter.ts';
import { parseResumePdf } from '../pdf.ts';
import { DEFAULT_JUDGE_PROMPT, JUDGE_PROMPT_NAME, QUICK_JUDGE_PROMPT_NAME, RESERVED_NAMES } from '@pinloop/shared';

export type JudgingSummary = { userId: string; judged: number; failed: number };

type ProfileDocRow = typeof profileDocuments.$inferSelect;
type PostingRow = typeof postings.$inferSelect;

const PROFILE_SUBSTANCE_NAMES = ['constraints', 'background', 'preferences', 'resume'];
const DEFAULT_BATCH_SIZE = 25;

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
    if (doc.textContent) sections.push(`${doc.name}:\n${doc.textContent}`);
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

export async function runJudging(callModel: typeof callJudgeModel = callJudgeModel): Promise<JudgingSummary[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.JUDGE_MODEL;
  if (!apiKey || !model) return [];

  const limit = batchSize();
  const summaries: JudgingSummary[] = [];
  const accounts = await getDb().select({ id: users.id }).from(users);

  for (const account of accounts) {
    try {
      const docs = await getDb().select().from(profileDocuments).where(eq(profileDocuments.userId, account.id));
      const hasSubstance = docs.some((doc) => PROFILE_SUBSTANCE_NAMES.includes(doc.name));
      if (!hasSubstance) continue;

      const candidates = await getDb()
        .select({ posting: postings })
        .from(postings)
        .leftJoin(judgments, and(eq(judgments.postingId, postings.id), eq(judgments.userId, account.id)))
        .where(isNull(judgments.id))
        .orderBy(asc(postings.createdAt))
        .limit(limit);
      if (candidates.length === 0) continue;

      const systemPrompt = resolveJudgePrompt(docs);
      const profileText = await buildProfileText(docs);

      let judged = 0;
      let failed = 0;
      for (const { posting } of candidates) {
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

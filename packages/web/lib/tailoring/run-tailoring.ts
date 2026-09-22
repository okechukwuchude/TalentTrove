import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { createElement, type ReactElement } from 'react';
import { pathToFileURL } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';
import { closeDb, getDb } from '../db.ts';
import { judgments, postings, profileDocuments, tailoredResumes, users } from '../../db/schema.ts';
import { extractStyleProfile, tailorResumeContent, type StyleProfile } from './openrouter.ts';
import { TailoredResumeDocument } from './resume-template.tsx';
import { parseResumePdf } from '../pdf.ts';
import { JUDGE_PROMPT_NAME, QUICK_JUDGE_PROMPT_NAME, RESERVED_NAMES, VERDICTS, rankOf } from '@talenttrove/shared';

export type TailoringSummary = { userId: string; tailored: number; failed: number };

type ProfileDocRow = typeof profileDocuments.$inferSelect;
type PostingRow = typeof postings.$inferSelect;

const DEFAULT_BATCH_SIZE = 25;

/**
 * How long runTailoring() is willing to keep starting new style-extraction
 * or tailoring calls before it stops and returns whatever it's finished so
 * far. Set well under the cron route's `maxDuration = 300` (see
 * app/api/cron/tailor-resumes/route.ts) so the function always has time to
 * finish its current insert and respond normally, rather than getting killed
 * mid-request by Vercel's FUNCTION_INVOCATION_TIMEOUT — which returns
 * nothing to the caller and drops whatever candidate was in flight. Anything
 * left over when the budget runs out is picked up by the next scheduled run,
 * since the candidate query already skips postings that already have a
 * tailored_resumes row.
 */
export const TIME_BUDGET_MS = 270_000;

/**
 * The lowest verdict a judgment can carry and still be worth tailoring a
 * resume for. Derived from the shared four-word scale (`@talenttrove/shared`'s
 * `VERDICTS`) rather than spelled out as a literal array here, so this file
 * never has its own opinion about what the words are or their order — see
 * `packages/shared/src/verdicts.ts` for why that matters.
 */
const TAILOR_MIN_VERDICT = 'fair';
const TAILOR_VERDICTS = VERDICTS.filter((verdict) => rankOf(verdict) >= rankOf(TAILOR_MIN_VERDICT));

/**
 * Resume is excluded here (unlike run-judging.ts's buildProfileText, which
 * includes it) because tailoring passes resume text as its own separate
 * `resumeText` parameter — duplicating it inside profileText too would waste
 * tokens and give the model two copies of the same content under different
 * labels.
 */
const PROFILE_TEXT_SKIP_NAMES: ReadonlySet<string> = new Set(
  [JUDGE_PROMPT_NAME, QUICK_JUDGE_PROMPT_NAME, 'resume'].filter((name) =>
    Object.prototype.hasOwnProperty.call(RESERVED_NAMES, name),
  ),
);

function batchSize(): number {
  const raw = process.env.TAILOR_BATCH_SIZE;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

function buildProfileText(docs: ProfileDocRow[]): string {
  const sections: string[] = [];
  for (const doc of docs) {
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

export async function runTailoring(
  callStyleExtraction: typeof extractStyleProfile = extractStyleProfile,
  callTailor: typeof tailorResumeContent = tailorResumeContent,
  now: () => number = Date.now,
): Promise<TailoringSummary[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.JUDGE_MODEL;
  if (!apiKey || !model) return [];

  const limit = batchSize();
  const summaries: TailoringSummary[] = [];
  const accounts = await getDb().select({ id: users.id }).from(users);
  const deadline = now() + TIME_BUDGET_MS;

  for (const account of accounts) {
    if (now() >= deadline) break;
    try {
      const [resumeDoc] = await getDb()
        .select()
        .from(profileDocuments)
        .where(and(eq(profileDocuments.userId, account.id), eq(profileDocuments.name, 'resume')));
      if (!resumeDoc?.fileBytes) continue;

      const candidates = await getDb()
        .select({ posting: postings })
        .from(postings)
        .innerJoin(
          judgments,
          and(
            eq(judgments.postingId, postings.id),
            eq(judgments.userId, account.id),
            inArray(judgments.verdict, TAILOR_VERDICTS),
          ),
        )
        .leftJoin(tailoredResumes, and(eq(tailoredResumes.postingId, postings.id), eq(tailoredResumes.userId, account.id)))
        .where(isNull(tailoredResumes.id))
        .orderBy(asc(judgments.judgedAt))
        .limit(limit);
      if (candidates.length === 0) continue;

      const resumeText = (await parseResumePdf(resumeDoc.fileBytes)).text;
      // A resume row with bytes isn't enough: a scanned/image-only PDF parses
      // cleanly to empty text (see lib/pdf.ts's NO_TEXT_NOTE). Extracting a
      // "contact block" from nothing means the model invents one — and that
      // invention is cached on style_profile and stamped on every tailored
      // PDF from then on, since re-tailoring is out of scope.
      if (!resumeText.trim()) continue;

      let styleProfile: StyleProfile;
      if (resumeDoc.styleProfile) {
        styleProfile = resumeDoc.styleProfile as StyleProfile;
      } else {
        const extracted = await callStyleExtraction(apiKey, model, resumeText);
        if ('error' in extracted) {
          console.error(`tailor: user ${account.id} style extraction failed: ${extracted.error}`);
          summaries.push({ userId: account.id, tailored: 0, failed: candidates.length });
          continue;
        }
        styleProfile = extracted;
        await getDb()
          .update(profileDocuments)
          .set({ styleProfile: extracted })
          .where(and(eq(profileDocuments.userId, account.id), eq(profileDocuments.name, 'resume')));
      }

      const docs = await getDb().select().from(profileDocuments).where(eq(profileDocuments.userId, account.id));
      const profileText = buildProfileText(docs);

      let tailored = 0;
      let failed = 0;
      for (const { posting } of candidates) {
        if (now() >= deadline) break;
        try {
          const content = await callTailor(apiKey, model, {
            resumeText,
            postingText: buildPostingText(posting),
            profileText,
            sectionOrder: styleProfile.sectionOrder,
          });
          if ('error' in content) {
            console.error(`tailor: user ${account.id} posting ${posting.id} failed: ${content.error}`);
            failed += 1;
            continue;
          }
          const pdfBytes = await renderToBuffer(
            createElement(TailoredResumeDocument, {
              contact: styleProfile.contact,
              sectionOrder: styleProfile.sectionOrder,
              summary: content.summary,
              skills: content.skills,
              experience: content.experience,
              education: content.education,
            }) as ReactElement<any, any>,
          );
          await getDb()
            .insert(tailoredResumes)
            .values({ userId: account.id, postingId: posting.id, pdfBytes, coverLetter: content.coverLetter, model })
            .onConflictDoNothing();
          tailored += 1;
        } catch (error) {
          console.error(`tailor: user ${account.id} posting ${posting.id} threw`, error);
          failed += 1;
        }
      }
      summaries.push({ userId: account.id, tailored, failed });
    } catch (error) {
      console.error(`tailor: user ${account.id} threw`, error);
    }
  }
  return summaries;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const summary = await runTailoring();
  console.log(JSON.stringify(summary, null, 2));
  await closeDb();
}

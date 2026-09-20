/**
 * The four words a verdict may be, and the two small things every side of the
 * product does with them.
 *
 * A verdict is the model's own word about one job posting and one person: `no`,
 * `weak`, `fair` or `strong`, worst to best. The order matters, because a run
 * can be told to keep only postings at or above one of the four words, so the
 * list below is a scale rather than a set.
 *
 * These four words are written down once, here, and everything else reads them
 * from here. Three different places need them and they must never disagree.
 * The file that builds the model request puts the four words in the request as
 * the only answers the model may give, and refuses an answer outside them. The
 * judge run and the judgment listing check a typed verdict against them. And
 * a UI reports "dropped: judged weak, below fair" for every posting a keep
 * word dropped, which needs the wording of that line too — `dropReason`
 * below — without needing anything else the judge run does.
 *
 * That last point is why this file sits under packages/shared/ rather than
 * inside the judge run: a route handler and a React component both need the
 * four words and dropReason without pulling in the model provider, the
 * search, the fetch, the profile reader and the embedder that the judge run
 * itself depends on.
 *
 * Nothing in this file opens a connection, reads a credential, calls a model or
 * touches the filesystem. It is four words and two functions over them.
 */

/**
 * The four words a verdict may be, worst to best.
 *
 * Growing or reordering this list changes what the model is allowed to answer
 * and what a "keep at" filter compares against, all at once. It is a spec
 * change (specs/feature-judge.md), never a tidy-up.
 */
export const VERDICTS = ['no', 'weak', 'fair', 'strong'] as const;

/** One of the four words, as a type. */
export type Verdict = (typeof VERDICTS)[number];

/**
 * Why a judge step in a routine, or a judge run in a terminal, left a posting
 * out: the verdict it was given and the word the run was keeping at, so a person
 * reading the report sees both the judgement and the rule that acted on it.
 */
export function dropReason(verdict: string, keep: string): string {
  return `judged ${verdict}, below ${keep}`;
}

/** Where a verdict sits on the four-word scale; higher is better. */
export function rankOf(verdict: string): number {
  return VERDICTS.indexOf(verdict as Verdict);
}

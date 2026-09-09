import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

/**
 * The only fields `/api/search` is ever allowed to forward upstream. Per the
 * plan's Global Constraint, this route must never let a client set
 * `semantic`, `from_profile`, `min_match`, or `preview` (or anything else
 * not on this list) on the request that reaches the server's `/search` —
 * those toggle server-side behavior this word/filter-only page doesn't
 * expose, so a posted field with any other name is silently dropped rather
 * than forwarded.
 */
const ALLOWED_SEARCH_BODY_KEYS = [
  'q',
  'country',
  'workplace',
  'employment',
  'posted_after',
  'company',
  'unjudged',
  'limit',
  'cursor',
] as const;

function allowedSearchBody(input: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of ALLOWED_SEARCH_BODY_KEYS) {
    if (key in input) body[key] = input[key];
  }
  return body;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const body = allowedSearchBody(rawBody);

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, '/search', { method: 'POST', body });
    const asRecord = json as
      | { rows?: unknown; cursor?: unknown; next_cursor?: unknown; interpretation?: unknown }
      | undefined;
    const rows = Array.isArray(asRecord?.rows) ? asRecord.rows : [];
    const cursor = asRecord?.cursor ?? asRecord?.next_cursor ?? null;
    const interpretation = asRecord?.interpretation;
    return withRenewedCookie(auth.session, Response.json({ rows, cursor, interpretation }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not search';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}

# Tabs, rebuilt on our own database

Status: approved design, pending spec review
Date: 2026-09-11

## Why

`2026-09-09-auth-database-foundation-design.md` replaced TalentTrove's hosted
auth with our own Postgres-backed sessions, and as an accepted consequence
stubbed `/api/tabs`, `/api/search`, and `/api/companies` to `501` — those
routes used to forward a TalentTrove `accessToken` to `api.talenttrove.ai`, which no
longer exists. That auth spec named tabs, job postings/search, and judge as
three follow-on pieces, each needing its own spec/plan.

This spec covers tabs — a user's named, saved lists of job postings
(`/tabs`, `/tabs/[name]`). It is picked first because it is the smallest of
the three and follows a pattern this codebase has already used twice
(auth-db, profile-db): its own Drizzle tables, a `*-db.ts` data-access
layer, and route handlers that call it directly, no BFF proxying.

**Why this can't wait for the search/postings project:** tabs need a table
of job postings to reference (to show a title/company/url, and to support
"no longer present"). Rather than block tabs on the (larger, unscoped)
search/scraping project, this spec creates the shared `postings` table now,
schema-only. The search/scraping project, whenever it's specced, becomes
"the thing that populates and queries this same table" — it does not own a
competing schema.

**Explicitly not in scope for this piece:** job postings search, scraping,
ranking, or judge. `postings` ships empty except for rows inserted by a
dev-only seed script (for manual local testing) until the search project
exists. `/api/search` and `/api/companies` stay `501`.

## Database

Three new tables in `packages/web/db/schema.ts`, alongside the existing
`users`/`sessions`/`password_reset_tokens`/`profile_documents`.

### Schema

```ts
export const postings = pgTable('postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  locations: text('locations').array(),
  workplace: text('workplace'),
  employment: text('employment'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  url: text('url').notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tabs = pgTable('tabs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userName: uniqueIndex('tabs_user_id_name_key').on(table.userId, table.name),
}));

export const tabItems = pgTable('tab_items', {
  id: uuid('id').primaryKey().defaultRandom(), // this is "item_id" everywhere in the API
  tabId: uuid('tab_id').notNull().references(() => tabs.id, { onDelete: 'cascade' }),
  postingId: uuid('posting_id').notNull(), // deliberately NOT a foreign key — see below
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tabPosting: uniqueIndex('tab_items_tab_id_posting_id_key').on(table.tabId, table.postingId),
}));
```

**`tab_items.posting_id` carries no foreign-key constraint.** Postings are
expected to be pruned over time by whatever the search/scraping project
becomes (stale listings, delistings). A hard FK would force a choice between
`ON DELETE CASCADE` (a saved tab item silently vanishes when its posting is
cleaned up — wrong, the user chose to save it) or blocking the delete
entirely (wrong, it punishes the cleanup job for something a user did).
Leaving it unconstrained means a posting can be deleted freely, and a tab
item whose `posting_id` no longer resolves becomes exactly the signal that
produces the existing frontend's "no longer present" banner
(`app/tabs/[name]/tab-detail-view.tsx`) — this is not a workaround, it's the
mechanism the frontend already expects, ported from the old TalentTrove-backed
design as-is.

Tabs are looked up by `(user_id, name)`, matching the `/api/tabs/[name]`
route shape already in place — not by a separate opaque slug.

### Dev seed script

`packages/web/db/seed-postings.ts`, run manually (`npx tsx db/seed-postings.ts`
or similar) against `DATABASE_URL`, inserts a handful of fake postings so a
developer can create a tab, add postings to it, and see "no longer present"
by deleting one by hand. It is not part of any route, any user flow, or the
migration chain — purely a local convenience, gitignored output aside.

## Endpoints

All of these replace the current `501` stub bodies; the `requireSession`
401 guard already in each stub stays as the first check, unchanged.

- **`GET /api/tabs`** — the caller's tabs, most-recently-created first:
  `{rows: [{name, description?, items}]}` where `items` is a count of
  `tab_items` rows for that tab (not filtered by whether the posting still
  exists — a count that changes when postings quietly disappear would be
  confusing).
- **`POST /api/tabs`** — body `{name, description?}`. `400` if `name` is
  missing/blank, or a tab with that name already exists for this user
  (message: `"a tab named "<name>" already exists"`). Returns
  `{rows: [{name, description, items: 0}]}` on success.
- **`GET /api/tabs/[name]`** — cursor-paginated (`limit`, `cursor` query
  params, same shape/convention as `/api/search`):
  `{rows: Posting[], cursor: string | null, no_longer_present: {posting_id, item_id}[]}`.
  Built as one query joining `tab_items` to `postings`: items with a match
  go into `rows` (mapped through the existing `Posting` shape, with
  `item_id` set to the `tab_items.id`); items with no match go into
  `no_longer_present`. `404` if the tab doesn't belong to the caller (not
  `403` — don't leak whether the name exists for someone else).
- **`DELETE /api/tabs/[name]`** — deletes the tab; `tab_items` cascade with
  it. `404` if not found for this caller. Returns `{deleted: true}`.
- **`POST /api/tabs/[name]/rename`** — body `{to}`. `400` if `to` is
  blank or collides with another tab this user already has. `404` if the
  tab to rename doesn't exist for this caller.
- **`POST /api/tabs/[name]/add`** — body `{ids: string[]}` (posting ids).
  `400` if `ids` is empty. For each id: if it matches a row in `postings`
  and isn't already in the tab, insert a `tab_items` row; if it's already
  present, add it to `already_present`; if no `postings` row matches, add
  it to `unknown`. Returns
  `{rows: Posting[], already_present: string[], unknown: string[], coverage: {covered, total}}`
  — `rows` is the tab's current contents for the newly-added ids (so the UI
  can show what just landed), `coverage.covered` is the count actually
  inserted, `coverage.total` is `ids.length`. `404` if the tab doesn't
  exist for this caller.
- **`POST /api/tabs/[name]/remove`** — body `{item_ids: string[]}`. `400`
  if empty. Deletes matching `tab_items` rows scoped to this tab; ids with
  no matching row go into `not_found`. Returns
  `{rows: Posting[], not_found: string[], coverage: {covered, total}}` —
  `rows` is the tab's remaining contents (first page). `404` if the tab
  doesn't exist for this caller.

Every route's data access goes through `lib/tabs-db.ts`, mirroring
`auth-db.ts`/`profile-db.ts`: functions take a `userId` explicitly and every
query filters on it — a route handler is never trusted to have already
checked ownership, the data layer checks again.

## Error handling

Same convention as every other route in this codebase: malformed/missing
JSON body → `400 {error: string}`; validation failures → `400` with a
specific message; ownership mismatch or missing resource → `404`, never
`403` (don't reveal whether a name exists under another account). No new
error types — this reuses the shape `sign-up`/`sign-in`/`profile` routes
already use.

## Testing

- `lib/tabs-db.ts` gets `lib/tabs-db.test.ts`, gated with
  `describe.skipIf(!process.env.TEST_DATABASE_URL)`, following
  `auth-db.test.ts`/`profile-db.test.ts` exactly: create/list/rename/delete
  a tab, add/remove postings (including the "unknown id" and "already
  present" branches), and a case that deletes a `postings` row out from
  under a `tab_items` row and confirms it surfaces in `no_longer_present`
  and not in `rows`.
- Each route file gets a route test in the same gated style as the current
  `app/api/tabs/**/*.test.ts` stubs (which currently only assert 401/501) —
  extended to cover 400/404/200 once real behavior exists.
- The seed script gets one smoke test: running it against a test database
  inserts rows without throwing.
- No frontend test changes — `tab-queries.test.tsx`, `tabs-view.test.tsx`,
  and `tab-detail-view.test.tsx` already assert the exact JSON shapes this
  spec produces (they were written against the old TalentTrove-proxy version of
  these routes, which used the same wire contract).

## Migration/rollout note

This is a personal/single-user setup (see the auth spec's precedent): there
is no live traffic to protect, so `/api/tabs/*` moving from `501` straight
to real behavior is not a breaking change for anyone. `npx drizzle-kit
generate` after adding the three tables produces one new migration on top
of the existing `0000_*` migration; no data migration is needed since
`profile_documents` and everything before it is untouched.

## Out of scope for this design

- Job postings search, scraping, ranking, or any populating of `postings`
  beyond the dev seed script — its own spec/plan, next.
- Judge (screening/ranking postings against a profile) — depends on search
  existing first.
- A manual "add a posting by URL" UI — deliberately deferred; the seed
  script covers local testing until search ships.

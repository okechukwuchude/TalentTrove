import { customType, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256(token), hex — never the raw token
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  tokenHash: text('token_hash').primaryKey(), // sha256(token), hex
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const profileDocuments = pgTable(
  'profile_documents',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // 'text' | 'file'
    textContent: text('text_content'), // set when kind = 'text'
    fileBytes: bytea('file_bytes'), // set when kind = 'file' — the resume PDF
    bytes: integer('bytes').notNull(),
    originalFilename: text('original_filename'), // set when kind = 'file'
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.name] })],
);

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    company: text('company').notNull(),
    locations: text('locations').array(),
    country: text('country'),
    workplace: text('workplace'),
    employment: text('employment'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    url: text('url').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('postings_url_key').on(table.url)],
);

export const tabs = pgTable(
  'tabs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tabs_user_id_name_key').on(table.userId, table.name)],
);

export const tabItems = pgTable(
  'tab_items',
  {
    id: uuid('id').primaryKey().defaultRandom(), // this is "item_id" everywhere in the API
    tabId: uuid('tab_id')
      .notNull()
      .references(() => tabs.id, { onDelete: 'cascade' }),
    postingId: uuid('posting_id').notNull(), // deliberately not a foreign key — see the design spec
    addedAt: timestamp('added_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tab_items_tab_id_posting_id_key').on(table.tabId, table.postingId)],
);

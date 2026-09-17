import { customType, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    styleProfile: jsonb('style_profile'), // cached section-order/contact extraction — meaningful only on the 'resume' row; cleared to null when the file changes
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
    description: text('description'),
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

export const judgments = pgTable(
  'judgments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postingId: uuid('posting_id').notNull(), // deliberately not a foreign key — see the design spec
    verdict: text('verdict').notNull(),
    reasoning: text('reasoning').notNull(),
    model: text('model').notNull(),
    judgedAt: timestamp('judged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('judgments_user_id_posting_id_key').on(table.userId, table.postingId)],
);

export const tailoredResumes = pgTable(
  'tailored_resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postingId: uuid('posting_id').notNull(), // deliberately not a foreign key — same reasoning as judgments.postingId
    pdfBytes: bytea('pdf_bytes').notNull(),
    coverLetter: text('cover_letter').notNull(),
    model: text('model').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tailored_resumes_user_id_posting_id_key').on(table.userId, table.postingId)],
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postingId: uuid('posting_id').notNull(), // deliberately not a foreign key — same reasoning as judgments/tailoredResumes
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('applications_user_id_posting_id_key').on(table.userId, table.postingId)],
);

export const routines = pgTable(
  'routines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(),
    judgePrompt: text('judge_prompt'),
    destinationTab: text('destination_tab'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('routines_user_id_name_key').on(table.userId, table.name)],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  roles: text('roles').array(),
  countries: text('countries').array(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // plaintext for non-secret keys; AES-256-GCM ciphertext for secret keys (lib/settings-crypto.ts)
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

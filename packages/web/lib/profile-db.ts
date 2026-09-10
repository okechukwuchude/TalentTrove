import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from './db.ts';
import { profileDocuments } from '../db/schema.ts';

export type ProfileDocumentSummary = {
  name: string;
  kind: 'text' | 'file';
  bytes: number;
  updatedAt: Date;
  originalFilename: string | null;
};

export type ProfileDocumentDetail = ProfileDocumentSummary & {
  textContent: string | null;
};

/** The JSON shape a profile document row takes in every route response. */
export type ProfileDocumentRowJson = {
  name: string;
  kind: 'text' | 'file';
  bytes: number;
  updated_at: string;
  original_filename?: string;
};

/**
 * The one serializer for a profile document row's public JSON shape, used by
 * both GET /api/profile's list mapper and POST /api/profile/[name]'s
 * file-branch response. `original_filename` is omitted (not sent as null)
 * when the row has none, matching the list endpoint's original convention --
 * having two hand-written serializers disagree on this was exactly the kind
 * of drift this function exists to prevent.
 */
export function toRowJson(row: ProfileDocumentSummary): ProfileDocumentRowJson {
  return {
    name: row.name,
    kind: row.kind,
    bytes: row.bytes,
    updated_at: row.updatedAt.toISOString(),
    ...(row.originalFilename ? { original_filename: row.originalFilename } : {}),
  };
}

const SUMMARY_COLUMNS = {
  name: profileDocuments.name,
  kind: profileDocuments.kind,
  bytes: profileDocuments.bytes,
  updatedAt: profileDocuments.updatedAt,
  originalFilename: profileDocuments.originalFilename,
} as const;

function asSummary(row: {
  name: string;
  kind: string;
  bytes: number;
  updatedAt: Date;
  originalFilename: string | null;
}): ProfileDocumentSummary {
  return { ...row, kind: row.kind as 'text' | 'file' };
}

export async function listProfileDocuments(userId: string): Promise<ProfileDocumentSummary[]> {
  const rows = await getDb()
    .select(SUMMARY_COLUMNS)
    .from(profileDocuments)
    .where(eq(profileDocuments.userId, userId))
    .orderBy(profileDocuments.name);
  return rows.map(asSummary);
}

export async function getProfileDocument(userId: string, name: string): Promise<ProfileDocumentDetail | null> {
  const [row] = await getDb()
    .select({ ...SUMMARY_COLUMNS, textContent: profileDocuments.textContent })
    .from(profileDocuments)
    .where(and(eq(profileDocuments.userId, userId), eq(profileDocuments.name, name)));
  if (!row) return null;
  return { ...asSummary(row), textContent: row.textContent };
}

export async function upsertTextDocument(
  userId: string,
  name: string,
  text: string,
): Promise<ProfileDocumentSummary> {
  const bytes = Buffer.byteLength(text, 'utf8');
  const [row] = await getDb()
    .insert(profileDocuments)
    .values({ userId, name, kind: 'text', textContent: text, bytes, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [profileDocuments.userId, profileDocuments.name],
      set: { kind: 'text', textContent: text, fileBytes: null, originalFilename: null, bytes, updatedAt: new Date() },
    })
    .returning(SUMMARY_COLUMNS);
  return asSummary(row!);
}

export async function upsertFileDocument(
  userId: string,
  name: string,
  bytes: Buffer,
  originalFilename: string,
): Promise<ProfileDocumentSummary> {
  const [row] = await getDb()
    .insert(profileDocuments)
    .values({
      userId,
      name,
      kind: 'file',
      fileBytes: bytes,
      bytes: bytes.length,
      originalFilename,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [profileDocuments.userId, profileDocuments.name],
      set: {
        kind: 'file',
        textContent: null,
        fileBytes: bytes,
        bytes: bytes.length,
        originalFilename,
        updatedAt: new Date(),
      },
    })
    .returning(SUMMARY_COLUMNS);
  return asSummary(row!);
}

export async function deleteProfileDocument(userId: string, name: string): Promise<void> {
  await getDb()
    .delete(profileDocuments)
    .where(and(eq(profileDocuments.userId, userId), eq(profileDocuments.name, name)));
}

export async function sumOtherTextBytes(userId: string, excludingName: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${profileDocuments.bytes}), 0)` })
    .from(profileDocuments)
    .where(
      and(
        eq(profileDocuments.userId, userId),
        eq(profileDocuments.kind, 'text'),
        ne(profileDocuments.name, excludingName),
      ),
    );
  return Number(row?.total ?? 0);
}

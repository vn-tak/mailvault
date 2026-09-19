import type {
  Attachment,
  AuthVerdict,
  ExtractedCode,
  MessageAuth,
  MessageDetail,
  MessageListQuery,
  MessageSummary,
  VerificationLink,
} from "@mailvault/shared";
import { newId, nowIso } from "../lib/util";
import { parseJson, toMessageAuth, toMessageSummary } from "./mappers";
import type { AttachmentRow, MessageRow } from "./rows";

export interface InsertMessageInput {
  domainId: string;
  aliasId: string | null;
  providerMessageId: string | null;
  dedupeKey: string;
  envelopeFrom: string;
  envelopeTo: string;
  headerFrom: string | null;
  headerTo: string | null;
  subject: string | null;
  preview: string | null;
  receivedAt: string;
  rawSize: number;
  rawR2Key: string;
  parsedR2Key: string | null;
  hasAttachments: boolean;
  attachmentCount: number;
  codes: ExtractedCode[];
  links: VerificationLink[];
  authVerdict: AuthVerdict;
  auth: MessageAuth | null;
}

export interface InsertAttachmentInput {
  filename: string;
  safeFilename: string;
  contentType: string | null;
  size: number;
  r2Key: string;
  contentId: string | null;
}

function changes(res: { meta?: unknown }): number {
  return Number((res.meta as { changes?: number } | undefined)?.changes ?? 0);
}

/** Returns the new message id, or null when the dedupe_key already existed. */
export async function insertMessage(db: D1Database, m: InsertMessageInput): Promise<string | null> {
  const id = newId();
  try {
    await db
      .prepare(
        `INSERT INTO messages (
          id, domain_id, alias_id, provider_message_id, dedupe_key,
          envelope_from, envelope_to, header_from, header_to, subject, preview,
          received_at, raw_size, raw_r2_key, parsed_r2_key, has_attachments,
          attachment_count, is_read, extracted_codes_json, verification_links_json,
          auth_verdict, auth_json, created_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,0,?18,?19,?20,?21,?22)`,
      )
      .bind(
        id,
        m.domainId,
        m.aliasId,
        m.providerMessageId,
        m.dedupeKey,
        m.envelopeFrom,
        m.envelopeTo,
        m.headerFrom,
        m.headerTo,
        m.subject,
        m.preview,
        m.receivedAt,
        m.rawSize,
        m.rawR2Key,
        m.parsedR2Key,
        m.hasAttachments ? 1 : 0,
        m.attachmentCount,
        JSON.stringify(m.codes),
        JSON.stringify(m.links),
        m.authVerdict,
        m.auth ? JSON.stringify(m.auth) : null,
        nowIso(),
      )
      .run();
    return id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed: messages.dedupe_key/i.test(msg)) return null;
    throw err;
  }
}

export async function dedupeKeyExists(db: D1Database, dedupeKey: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS x FROM messages WHERE dedupe_key = ?1`)
    .bind(dedupeKey)
    .first<{ x: number }>();
  return !!row;
}

export async function insertAttachments(
  db: D1Database,
  messageId: string,
  attachments: InsertAttachmentInput[],
): Promise<void> {
  if (attachments.length === 0) return;
  const now = nowIso();
  const stmts = attachments.map((a) =>
    db
      .prepare(
        `INSERT INTO attachments (id, message_id, filename, safe_filename, content_type, size, r2_key, content_id, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
      )
      .bind(newId(), messageId, a.filename, a.safeFilename, a.contentType, a.size, a.r2Key, a.contentId, now),
  );
  await db.batch(stmts);
}

function buildListFilters(query: MessageListQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.filter === "unread") clauses.push("m.is_read = 0");
  if (query.domainId) {
    params.push(query.domainId);
    clauses.push(`m.domain_id = ?${params.length}`);
  }
  if (query.aliasId) {
    params.push(query.aliasId);
    clauses.push(`m.alias_id = ?${params.length}`);
  }
  if (query.q) {
    const like = `%${query.q.toLowerCase()}%`;
    const i = params.length;
    params.push(like, like, like, like);
    clauses.push(
      `(lower(m.header_from) LIKE ?${i + 1} OR lower(m.subject) LIKE ?${i + 2}
        OR lower(COALESCE(a.address, m.envelope_to)) LIKE ?${i + 3}
        OR lower(COALESCE(a.label,'')) LIKE ?${i + 4})`,
    );
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const SELECT_LIST = `
  FROM messages m
  LEFT JOIN aliases a ON a.id = m.alias_id
  LEFT JOIN domains d ON d.id = m.domain_id`;

export async function listMessages(
  db: D1Database,
  query: MessageListQuery,
): Promise<{ items: MessageSummary[]; total: number }> {
  const { where, params } = buildListFilters(query);
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS c ${SELECT_LIST} ${where}`)
    .bind(...params)
    .first<{ c: number }>();
  const total = Number(countRow?.c ?? 0);
  const { results } = await db
    .prepare(
      `SELECT m.*, a.label AS alias_label, a.address AS alias_address, d.name AS domain_name
       ${SELECT_LIST} ${where}
       ORDER BY m.received_at DESC, m.id DESC
       LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .bind(...params, query.limit, query.offset)
    .all<MessageRow>();
  return { items: (results ?? []).map(toMessageSummary), total };
}

export async function getMessageRow(db: D1Database, id: string): Promise<MessageRow | null> {
  return db
    .prepare(
      `SELECT m.*, a.label AS alias_label, a.address AS alias_address, d.name AS domain_name
       FROM messages m
       LEFT JOIN aliases a ON a.id = m.alias_id
       LEFT JOIN domains d ON d.id = m.domain_id
       WHERE m.id = ?1`,
    )
    .bind(id)
    .first<MessageRow>();
}

export async function getMessageAttachments(db: D1Database, messageId: string): Promise<Attachment[]> {
  const { results } = await db
    .prepare(`SELECT * FROM attachments WHERE message_id = ?1 ORDER BY size DESC`)
    .bind(messageId)
    .all<AttachmentRow>();
  return (results ?? []).map((r) => ({
    id: r.id,
    filename: r.filename,
    contentType: r.content_type ?? "application/octet-stream",
    size: Number(r.size),
    contentId: r.content_id,
    downloadPath: `/api/messages/${messageId}/attachments/${r.id}`,
  }));
}

export async function getMessageDetail(db: D1Database, id: string): Promise<MessageDetail | null> {
  const row = await getMessageRow(db, id);
  if (!row) return null;
  const summary = toMessageSummary(row);
  const attachments = await getMessageAttachments(db, id);
  return {
    ...summary,
    providerMessageId: row.provider_message_id,
    rawSize: Number(row.raw_size),
    extractedCodes: parseJson<ExtractedCode[]>(row.extracted_codes_json, []),
    verificationLinks: parseJson<VerificationLink[]>(row.verification_links_json, []),
    attachments,
    htmlBody: null, // filled by the route from R2 parsed content + sanitization
    textBody: null,
    parseDegraded: !row.parsed_r2_key,
    auth: toMessageAuth(row),
  };
}

export async function setMessageRead(db: D1Database, id: string, isRead: boolean): Promise<number> {
  const res = await db
    .prepare(`UPDATE messages SET is_read = ?2 WHERE id = ?1`)
    .bind(id, isRead ? 1 : 0)
    .run();
  return changes(res);
}

export async function getRawKeysForMessage(db: D1Database, id: string): Promise<string[]> {
  const set = new Set<string>();
  const msg = await db
    .prepare(`SELECT raw_r2_key, parsed_r2_key FROM messages WHERE id = ?1`)
    .bind(id)
    .first<{ raw_r2_key: string; parsed_r2_key: string | null }>();
  if (msg) {
    set.add(msg.raw_r2_key);
    if (msg.parsed_r2_key) set.add(msg.parsed_r2_key);
  }
  const atts = await db
    .prepare(`SELECT r2_key FROM attachments WHERE message_id = ?1`)
    .bind(id)
    .all<{ r2_key: string }>();
  for (const a of atts.results ?? []) set.add(a.r2_key);
  return [...set];
}

/** Deletes the message (attachments cascade via FK) and returns its R2 keys to purge. */
export async function deleteMessage(db: D1Database, id: string): Promise<string[]> {
  const keys = await getRawKeysForMessage(db, id);
  const res = await db.prepare(`DELETE FROM messages WHERE id = ?1`).bind(id).run();
  return changes(res) === 0 ? [] : keys;
}

export async function findAttachment(
  db: D1Database,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentRow | null> {
  return db
    .prepare(`SELECT * FROM attachments WHERE id = ?1 AND message_id = ?2`)
    .bind(attachmentId, messageId)
    .first<AttachmentRow>();
}

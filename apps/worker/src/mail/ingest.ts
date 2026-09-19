import type { Env } from "../env";
import { maxMessageBytes } from "../env";
import { sha256Hex, newId, nowIso } from "../lib/util";
import { sanitizeFilename } from "../lib/filename";
import { log } from "../lib/logging";
import { findActiveAliasByAddress } from "../db/aliases";
import { getDomainById } from "../db/domains";
import { insertMessage, insertAttachments, dedupeKeyExists, indexMessage } from "../db/messages";
import type { InsertMessageInput, InsertAttachmentInput } from "../db/messages";
import {
  buildRawKey,
  buildParsedKey,
  buildAttachmentKey,
  putRaw,
  putParsed,
  putAttachment,
  deleteKeys,
} from "../storage/r2";
import { parseMime } from "./parse";
import { assessAuth } from "./auth";
import { AuthPolicy, AuthVerdict, type MessageAuth } from "@mailvault/shared";
import { extractOtp } from "./otp";
import { extractLinks } from "./links";
import { buildPreview, stripHtmlToText } from "./preview";
import { normalizeLookupAddress, splitAddress } from "./normalize";

export type IngestResult =
  | { status: "stored"; messageId: string }
  | { status: "duplicate" }
  | {
      status: "rejected";
      reason: "unknown_recipient" | "invalid_recipient" | "too_large" | "unauthenticated";
    };

interface Rejectable {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  setReject(reason: string): void;
}

/** Read a raw MIME stream into a bounded buffer; bail (without buffering) past the cap. */
async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Bounded for D1 storage; the verdict is computed from the full evidence, not this copy. */
function toStoredAuth(a: ReturnType<typeof assessAuth>): MessageAuth {
  return { ...a, reasons: a.reasons.map((r) => r.slice(0, 120)), evidence: a.evidence.slice(0, 8) };
}

/**
 * Core inbound handler logic (sections 10–19, 24). Kept free of the Hono request
 * layer so it can be unit/integration tested by constructing a message stand-in.
 *
 * Order (section 14): validate recipient -> validate size -> buffer raw -> parse ->
 * write R2 objects -> write D1 metadata; on D1 failure, clean up newly written R2.
 */
export async function ingestEmail(message: Rejectable, env: Env, db: D1Database, bucket: R2Bucket): Promise<IngestResult> {
  const recipient = normalizeLookupAddress(message.to);
  const { valid } = splitAddress(message.to);
  if (!valid || !recipient) {
    message.setReject("invalid recipient");
    log.warn("mail_rejected", { reason: "invalid_recipient" });
    return { status: "rejected", reason: "invalid_recipient" };
  }

  const alias = await findActiveAliasByAddress(db, recipient);
  if (!alias) {
    // Unknown or disabled aliases are dropped — never auto-created (section 11).
    message.setReject("no mailbox for this address");
    log.info("mail_rejected", { reason: "unknown_recipient", recipient });
    return { status: "rejected", reason: "unknown_recipient" };
  }

  const cap = maxMessageBytes(env);
  if (message.rawSize && message.rawSize > cap) {
    message.setReject("message too large");
    log.info("mail_rejected", { reason: "too_large", aliasId: alias.id });
    return { status: "rejected", reason: "too_large" };
  }

  const bytes = await readCapped(message.raw, cap);
  if (!bytes) {
    message.setReject("message too large");
    log.info("mail_rejected", { reason: "too_large", aliasId: alias.id });
    return { status: "rejected", reason: "too_large" };
  }

  const rawHex = await sha256Hex(bytes);
  // Dedupe key binds the envelope recipient to content so identical bodies BCC'd to
  // different aliases stay separate, while the same event redelivered dedupes.
  const dedupeKey = await sha256Hex(`${recipient}|${rawHex}`);
  if (await dedupeKeyExists(db, dedupeKey)) {
    log.info("mail_duplicate", { aliasId: alias.id });
    return { status: "duplicate" };
  }

  // Parse (malformed must not crash the Worker — section 16).
  let text: string | null = null;
  let html: string | null = null;
  let subject: string | null = null;
  let headerFrom: string | null = null;
  let headerTo: string | null = null;
  let providerMessageId: string | null = null;
  let receivedAt = message.headers.get("date") || nowIso();
  let parsedAttachments: { filename: string; contentType: string; contentId: string | null; bytes: Uint8Array }[] = [];
  let authResults: string[] = [];
  let degraded = false;
  try {
    const parsed = await parseMime(bytes);
    text = parsed.text;
    html = parsed.html;
    subject = parsed.subject;
    headerFrom = parsed.headerFrom;
    headerTo = parsed.headerTo;
    providerMessageId = parsed.messageId;
    if (parsed.date) receivedAt = parsed.date;
    parsedAttachments = parsed.attachments;
    authResults = parsed.authResults;
  } catch (err) {
    degraded = true;
    log.warn("mail_parse_failed", { aliasId: alias.id, error: err instanceof Error ? err.message : "parse_error" });
    headerTo = message.to;
  }

  // Judged before extraction: a spoofed message must never reach the owner looking like
  // a verified one, and its "code"/"verify link" are exactly what a phisher forges.
  const auth = assessAuth({ authResults, headerFrom, envelopeFrom: message.from });
  if (auth.verdict === AuthVerdict.Spoofed) {
    const domain = await getDomainById(db, alias.domainId);
    if (domain?.authPolicy === AuthPolicy.Reject) {
      message.setReject("sender authentication failed");
      log.warn("mail_rejected", { reason: "unauthenticated", aliasId: alias.id });
      return { status: "rejected", reason: "unauthenticated" };
    }
  }

  const codes = extractOtp(`${subject ?? ""}\n${text ?? stripHtmlToText(html ?? "")}`);
  const links = extractLinks(text ?? "", html);
  const preview = buildPreview(text, html);

  const messageId = newId();
  const rawKey = buildRawKey(alias.domainId, alias.id, receivedAt, messageId);
  const parsedKey = buildParsedKey(messageId);

  const writtenKeys: string[] = [rawKey, parsedKey];
  try {
    await putRaw(bucket, rawKey, bytes);
    await putParsed(bucket, parsedKey, {
      subject,
      from: headerFrom,
      to: headerTo,
      date: receivedAt,
      messageId: providerMessageId,
      text,
      html,
      degraded,
    });

    const attachmentRows: InsertAttachmentInput[] = [];
    for (const a of parsedAttachments) {
      const attId = newId();
      const safe = sanitizeFilename(a.filename);
      const key = buildAttachmentKey(messageId, attId, safe);
      await putAttachment(bucket, key, a.bytes, a.contentType);
      writtenKeys.push(key);
      attachmentRows.push({
        filename: a.filename,
        safeFilename: safe,
        contentType: a.contentType,
        size: a.bytes.byteLength,
        r2Key: key,
        contentId: a.contentId,
      });
    }

    const insert: InsertMessageInput = {
      domainId: alias.domainId,
      aliasId: alias.id,
      providerMessageId,
      dedupeKey,
      envelopeFrom: message.from,
      envelopeTo: message.to,
      headerFrom,
      headerTo,
      subject: subject ? subject.slice(0, 500) : null,
      preview,
      receivedAt,
      rawSize: bytes.byteLength,
      rawR2Key: rawKey,
      parsedR2Key: parsedKey,
      hasAttachments: attachmentRows.length > 0,
      attachmentCount: attachmentRows.length,
      codes,
      links,
      authVerdict: auth.verdict,
      auth: toStoredAuth(auth),
    };

    const insertedId = await insertMessage(db, insert);
    if (insertedId === null) {
      // Lost a dedupe race with a concurrent delivery of the same event.
      await deleteKeys(bucket, writtenKeys);
      log.info("mail_duplicate_race", { aliasId: alias.id });
      return { status: "duplicate" };
    }
    await insertAttachments(db, insertedId, attachmentRows);
    await indexMessage(db, insertedId, { subject, preview, sender: headerFrom });

    log.info("mail_stored", {
      aliasId: alias.id,
      domainId: alias.domainId,
      messageId: insertedId,
      codes: codes.length,
      links: links.length,
      attachments: attachmentRows.length,
      degraded,
      auth: auth.verdict,
    });
    return { status: "stored", messageId: insertedId };
  } catch (err) {
    // DB/persistence failure: remove everything we wrote so no orphan R2 remains
    // (section 14), then rethrow to let Cloudflare retry delivery (dedupe-safe).
    await deleteKeys(bucket, writtenKeys);
    log.error("mail_persist_failed", { aliasId: alias.id, error: err instanceof Error ? err.message : "error" });
    throw err;
  }
}

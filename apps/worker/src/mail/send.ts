import {
  AuthVerdict,
  MessageDirection,
  SEND_LIMITS,
  SendingStatus,
  SendStatus,
  type Domain,
  type SendOutcome,
} from "@mailvault/shared";
import type { Env } from "../env";
import { maxSendsPerDay } from "../env";
import { badRequest } from "../lib/errors";
import { log } from "../lib/logging";
import { newId, nowIso } from "../lib/util";
import { writeMetric } from "../lib/metrics";
import { findActiveAliasByAddress } from "../db/aliases";
import { getDomainById } from "../db/domains";
import { countSentSince, findThreadRoot, getMessageRow, indexMessage, insertMessage } from "../db/messages";
import type { InsertMessageInput } from "../db/messages";
import type { MessageRow } from "../db/rows";
import { buildParsedKey, buildRawKey, putParsed, putRaw } from "../storage/r2";
import { addressesOf, normalizeLookupAddress, splitAddress } from "./normalize";
import { buildPreview } from "./preview";
import { buildOutboundMime } from "./mime";

/** The compose request as the caller stated it, before anything is looked up. */
export interface OutboundRequest {
  fromAddress: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  replyTo?: string;
  /** Mail id being answered. Drives In-Reply-To/References and the thread it joins. */
  replyToMessageId?: string;
}

export type SendResult = { ok: true; outcome: SendOutcome } | { ok: false; code: string; message: string };

interface SendEmailRequest {
  from: string | { email: string; name?: string };
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
}

/**
 * The binding accepts these fields, but the installed runtime types still describe only the
 * `EmailMessage` form of `send()`. The cast is confined to this one call so that a
 * workers-types bump which adds the fields shows up as an unnecessary assertion rather than
 * quietly shipping a payload shape nobody checked.
 */
async function dispatch(email: SendEmail, request: SendEmailRequest): Promise<{ messageId: string }> {
  return email.send(request as unknown as Parameters<SendEmail["send"]>[0]);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Normalise, drop duplicates across to/cc/bcc, and reject anything not an address. */
function cleanList(list: string[] | undefined, seen: Set<string>): { ok: true; addresses: string[] } | { ok: false; bad: string } {
  const addresses: string[] = [];
  for (const raw of list ?? []) {
    const normalized = normalizeLookupAddress(raw);
    if (!normalized || !splitAddress(normalized).valid) return { ok: false, bad: raw };
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    addresses.push(normalized);
  }
  return { ok: true, addresses };
}

/**
 * Send one message as one of the owner's aliases.
 *
 * Three things hold this together. The `From` may only be an ACTIVE alias that already
 * exists in this mailbox — an address nobody created cannot send, which is what keeps this
 * endpoint from being an open relay. The message is written down *before* it goes, so a send
 * that succeeds while D1 is unhappy cannot produce mail the owner sent and never sees again.
 * And the domain must have Email Sending enabled, because Cloudflare refuses to sign for a
 * `From` it has not been told about.
 */
export async function sendOutbound(
  req: OutboundRequest,
  env: Env,
  db: D1Database,
  bucket: R2Bucket,
): Promise<SendResult> {
  const from = normalizeLookupAddress(req.fromAddress);
  if (!from || !splitAddress(from).valid) return fail("BAD_ADDRESS", "The sender address is not valid.");

  const alias = await findActiveAliasByAddress(db, from);
  if (!alias) {
    return fail("UNKNOWN_SENDER", `${from} is not one of your active aliases. Create it before sending from it.`);
  }

  const domain = await getDomainById(db, alias.domainId);
  if (!domain) return fail("UNKNOWN_SENDER", "That alias has no domain.");
  if (domain.sendingStatus !== SendingStatus.Enabled) {
    return fail(
      "SENDING_DISABLED",
      `${domain.name} is not enabled for sending yet. Enable Email Sending for that domain first.`,
    );
  }

  const seen = new Set<string>();
  const lists: { to: string[]; cc: string[]; bcc: string[] } = { to: [], cc: [], bcc: [] };
  for (const key of ["to", "cc", "bcc"] as const) {
    const cleaned = cleanList(req[key], seen);
    if (!cleaned.ok) return fail("BAD_ADDRESS", `${cleaned.bad} is not a valid address.`);
    lists[key] = cleaned.addresses;
  }
  if (lists.to.length === 0) return fail("NO_RECIPIENTS", "A message needs at least one recipient in To.");
  const recipientCount = lists.to.length + lists.cc.length + lists.bcc.length;
  if (recipientCount > SEND_LIMITS.maxRecipients) {
    return fail("TOO_MANY_RECIPIENTS", `At most ${SEND_LIMITS.maxRecipients} recipients per message, counting to, cc and bcc.`);
  }

  const budget = maxSendsPerDay(env);
  const already = await countSentSince(db, `${nowIso().slice(0, 10)}T00:00:00.000Z`);
  if (already >= budget) {
    return fail("DAILY_LIMIT", `You have sent ${already} of your ${budget} messages for today.`);
  }

  const parent = req.replyToMessageId ? await getMessageRow(db, req.replyToMessageId) : null;
  if (req.replyToMessageId && !parent) return fail("NOT_FOUND", "The message being answered no longer exists.");
  if (parent && isSpoofedIncoming(parent)) {
    return fail(
      "SPOOFED_PARENT",
      "That message failed sender authentication, so answering it would write to an impostor.",
    );
  }

  const baseSubject = (req.subject || parent?.subject || "").slice(0, SEND_LIMITS.maxSubjectChars);
  const subject = parent && baseSubject && !/^re:/i.test(baseSubject) ? `Re: ${baseSubject}` : baseSubject;
  if (!req.text.trim() && !req.html?.trim()) return fail("EMPTY_BODY", "Write something first.");
  if (utf8Bytes(req.text) + utf8Bytes(req.html ?? "") > SEND_LIMITS.maxTotalBytes) {
    return fail("TOO_LARGE", "The body is over the size limit for a single message.");
  }

  const inReplyTo = parent?.provider_message_id ?? null;
  const references = [...readReferences(parent?.references_json), ...(inReplyTo ? [inReplyTo] : [])];
  const messageId = newId();
  const sentAt = nowIso();
  const preview = buildPreview(req.text, req.html ?? null);
  const rawKey = buildRawKey(domain.id, alias.id, sentAt, messageId);
  const parsedKey = buildParsedKey(messageId);
  const threadRoot =
    (await findThreadRoot(db, [inReplyTo, ...references])) ?? parent?.thread_root_id ?? parent?.id ?? null;

  await putRaw(
    bucket,
    rawKey,
    new TextEncoder().encode(
      buildOutboundMime({
        from,
        fromName: req.fromName,
        to: lists.to,
        cc: lists.cc,
        bcc: lists.bcc,
        replyTo: req.replyTo,
        subject,
        text: req.text,
        html: req.html,
        // Our own id: Email Sending assigns the final Message-ID on the wire, so this is
        // the composed record rather than a transcript of the bytes that left.
        messageId: `${messageId}@${domain.name}`,
        date: new Date(sentAt),
        inReplyTo,
        references,
      }),
    ),
  );
  await putParsed(bucket, parsedKey, { text: req.text, html: req.html ?? null, degraded: false });

  const storedId = await insertMessage(db, {
    domainId: domain.id,
    aliasId: alias.id,
    providerMessageId: null,
    dedupeKey: `out|${messageId}`,
    envelopeFrom: from,
    envelopeTo: [...lists.to, ...lists.cc, ...lists.bcc].join(", "),
    headerFrom: req.fromName ? `${req.fromName} <${from}>` : from,
    headerTo: [...lists.to, ...lists.cc].join(", "),
    subject: subject.slice(0, 500),
    preview,
    receivedAt: sentAt,
    rawSize: utf8Bytes(req.text) + utf8Bytes(req.html ?? ""),
    rawR2Key: rawKey,
    parsedR2Key: parsedKey,
    hasAttachments: false,
    attachmentCount: 0,
    codes: [],
    links: [],
    // Our own mail is authenticated by definition: Email Sending signs it with this
    // domain's DKIM key and asserts this domain in SPF.
    authVerdict: AuthVerdict.Trusted,
    auth: null,
    direction: MessageDirection.Out,
    // Null means "this message is the conversation" and lets the insert use the row's own
    // id — the local id here names the R2 objects, not the row.
    threadRootId: threadRoot,
    inReplyTo,
    references,
    replyTo: req.replyTo ?? null,
    cc: lists.cc.length > 0 ? lists.cc.join(", ") : null,
    sendStatus: SendStatus.Queued,
    sendError: null,
  } satisfies InsertMessageInput);

  if (!storedId) throw badRequest("That message was already sent");
  await indexMessage(db, storedId, {
    subject,
    preview,
    // Sent mail is found by who it went to, since there is no external sender to match.
    sender: [...lists.to, ...lists.cc].join(", "),
  });

  let response: { messageId: string } | { error: Error };
  const extraHeaders = replyHeaders(inReplyTo, references);
  // Last, after every policy has been checked: "this server cannot send" must never be the
  // reason given for a message that was refused because it should not have been sent at all.
  if (!env.EMAIL) {
    await setSendResult(db, storedId, null, SendStatus.Failed, "BINDING_MISSING: no send_email binding on this deployment");
    return fail("BINDING_MISSING", "This server has no sending configured, so mail cannot leave the vault.");
  }
  try {
    response = await dispatch(env.EMAIL, {
      from: req.fromName ? { email: from, name: req.fromName } : from,
      to: lists.to,
      subject,
      text: req.text,
      ...(req.html ? { html: req.html } : {}),
      ...(lists.cc.length > 0 ? { cc: lists.cc } : {}),
      ...(lists.bcc.length > 0 ? { bcc: lists.bcc } : {}),
      ...(req.replyTo ? { replyTo: req.replyTo } : {}),
      ...(Object.keys(extraHeaders).length > 0 ? { headers: extraHeaders } : {}),
    });
  } catch (err) {
    response = { error: err instanceof Error ? err : new Error(String(err)) };
  }

  if ("error" in response) {
    const code = (response.error as Error & { code?: string }).code ?? "SEND_FAILED";
    const suppressed = code === "E_RECIPIENT_SUPPRESSED";
    await setSendResult(db, storedId, null, suppressed ? SendStatus.Suppressed : SendStatus.Failed, `${code}: ${response.error.message}`);
    writeMetric(env, "sending", { outcome: "failed", reason: code });
    log.warn("mail_send_failed", { messageId: storedId, code });
    return fail(
      code,
      suppressed
        ? "That address bounced or reported spam before, so Cloudflare is refusing it."
        : response.error.message,
    );
  }

  // The binding resolves once Email Sending has accepted the message; the recipient's
  // server answering is a separate event, recorded by the delivery-event queue. Until that
  // exists, `queued` is the honest word for "accepted, not yet confirmed".
  await setSendResult(db, storedId, response.messageId, SendStatus.Queued, null);
  writeMetric(env, "sending", { outcome: "accepted" });
  log.info("mail_sent", { messageId: storedId, recipients: recipientCount });
  return {
    ok: true,
    outcome: {
      id: storedId,
      status: SendStatus.Queued,
      providerMessageId: response.messageId,
      delivered: [],
      queued: [...lists.to, ...lists.cc, ...lists.bcc],
      bounced: [],
      suppressed: [],
      error: null,
    },
  };
}

function isSpoofedIncoming(row: MessageRow): boolean {
  return row.direction === MessageDirection.In && row.auth_verdict === AuthVerdict.Spoofed;
}

function readReferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function replyHeaders(inReplyTo: string | null, references: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  if (inReplyTo) headers["In-Reply-To"] = `<${inReplyTo}>`;
  if (references.length > 0) headers["References"] = references.map((r) => `<${r}>`).join(" ");
  return headers;
}

async function setSendResult(
  db: D1Database,
  id: string,
  providerMessageId: string | null,
  status: SendStatus,
  error: string | null,
): Promise<void> {
  await db
    .prepare(`UPDATE messages SET provider_message_id = ?2, send_status = ?3, send_error = ?4 WHERE id = ?1`)
    .bind(id, providerMessageId, status, error)
    .run();
}

/** Which of the owner's domains may be used as a `From` right now, and why not. */
export async function sendingDomains(db: D1Database, domains: Domain[]): Promise<Record<string, { canSend: boolean; reason: string | null }>> {
  const out: Record<string, { canSend: boolean; reason: string | null }> = {};
  for (const d of domains) {
    out[d.id] =
      d.sendingStatus === SendingStatus.Enabled
        ? { canSend: true, reason: null }
        : { canSend: false, reason: "sending_not_enabled" };
  }
  return out;
}

function fail(code: string, message: string): SendResult {
  return { ok: false, code, message };
}

/**
 * Answer one stored message.
 *
 * Both ends come from the row rather than the request: the sender is the alias the message
 * arrived on (or was sent from), and the recipient is whoever the message itself named —
 * `Reply-To` first, because that is the address its author asked for answers, then `From`.
 * Taking either from the client would let a crafted row aim a reply at somebody who never
 * appears in the conversation.
 */
export async function sendReply(
  parentId: string,
  req: { text: string; html?: string; subject?: string; fromName?: string; cc?: string[] },
  env: Env,
  db: D1Database,
  bucket: R2Bucket,
): Promise<SendResult> {
  const parent = await getMessageRow(db, parentId);
  if (!parent) return fail("NOT_FOUND", "That message is gone.");

  const from = parent.alias_address ?? "";
  if (!from) {
    return fail(
      "NO_ALIAS",
      "This mail has no alias of its own any more, so there is no address to answer from. Send a new message instead.",
    );
  }

  const ourAlias = normalizeLookupAddress(from);
  const candidates =
    parent.direction === MessageDirection.Out
      ? addressesOf(parent.header_to)
      : addressesOf(parent.reply_to ?? parent.header_from ?? parent.header_to);
  const to = candidates.filter((a) => a !== ourAlias);
  if (to.length === 0) {
    return fail("NO_TARGET", "There is nobody to answer on this message — its sender address is unusable.");
  }

  return sendOutbound(
    {
      fromAddress: from,
      to,
      cc: req.cc,
      subject: (req.subject ?? parent.subject ?? "").slice(0, SEND_LIMITS.maxSubjectChars),
      text: req.text,
      html: req.html,
      fromName: req.fromName,
      replyToMessageId: parentId,
    },
    env,
    db,
    bucket,
  );
}

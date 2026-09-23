import { SendStatus } from "@mailvault/shared";
import type { Env } from "../env";
import { log } from "../lib/logging";
import { writeMetric, Elapsed } from "../lib/metrics";
import { applyDeliveryEvent } from "../db/recipients";

/**
 * Email Sending delivery events.
 *
 * The `send_email` binding resolves as soon as Cloudflare has accepted the message, which
 * is not the same fact as "the recipient's server took it". The difference between those two
 * is what a mailbox has to show, because a message that never arrived is otherwise invisible:
 * it sits in Sent looking sent. Queues event subscriptions deliver that answer as one event
 * per (message, recipient), and this turns them back into rows.
 *
 * A message id that matches nothing is not an error. Mail sent before per-recipient tracking
 * existed, or from another Worker on the same domain, produces events this mailbox has no row
 * for; those are counted and acknowledged, never retried, because a retry can never make an
 * unknown id known.
 */

/** The event envelope as Queues delivers it — only the fields this consumer reads. */
interface DeliveryEventPayload {
  messageId?: unknown;
  recipient?: unknown;
  terminal?: unknown;
  delivery?: { status?: unknown; smtpStatusCode?: unknown; smtpResponse?: unknown };
  bounce?: { type?: unknown; reason?: unknown };
  rejection?: { reason?: unknown; party?: unknown; detail?: unknown };
  complaint?: { type?: unknown };
  failure?: { reason?: unknown };
}

export interface DeliveryEvent {
  providerMessageId: string;
  recipient: string;
  status: SendStatus;
  smtpCode: string | null;
  detail: string | null;
}

const STATUS_BY_EVENT: Record<string, SendStatus> = {
  delivered: SendStatus.Delivered,
  deferred: SendStatus.Deferred,
  bounced: SendStatus.Bounced,
  failed: SendStatus.Failed,
  rejected: SendStatus.Rejected,
  complained: SendStatus.Complained,
};

/** How many unmatchable ids one batch may name in the log, so a bad hour cannot flood it. */
const UNMATCHED_IDS_LOGGED = 3;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `cf.email.sending.message.delivered` → `delivered`. */
function eventSuffix(type: string | null): string | null {
  const hit = /^cf\.email\.sending\.message\.([a-z]+)$/i.exec(type ?? "");
  return hit ? (hit[1] ?? "").toLowerCase() : null;
}

/**
 * One event, or null when the record is not something this consumer can act on.
 *
 * `delivery.status` is preferred over the event type because it is what the provider
 * actually concluded; the type is the fallback for a payload that carries one without the
 * other. A suppression is reported as `rejected`, and it is worth naming separately, because
 * "the address is on the account's suppression list" is a different problem to solve from a
 * server that refused the message.
 */
export function parseDeliveryEvent(raw: unknown): DeliveryEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as { type?: unknown; payload?: DeliveryEventPayload };
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return null;

  const messageId = text(payload.messageId)?.replace(/^<|>$/g, "");
  const recipient = text(payload.recipient)?.toLowerCase();
  if (!messageId || !recipient) return null;

  const reported = text(payload.delivery?.status)?.toLowerCase();
  const fromType = eventSuffix(text(event.type));
  const key = (reported && STATUS_BY_EVENT[reported] ? reported : fromType) ?? null;
  if (!key) return null;
  let status = STATUS_BY_EVENT[key] ?? null;
  if (!status) return null;

  const detail =
    text(payload.delivery?.smtpResponse) ??
    text(payload.bounce?.reason) ??
    text(payload.rejection?.detail) ??
    text(payload.rejection?.reason) ??
    text(payload.failure?.reason) ??
    (payload.complaint?.type ? `complaint: ${text(payload.complaint.type) ?? ""}`.trim() : null);

  if (status === SendStatus.Rejected && /suppress/i.test(detail ?? "")) status = SendStatus.Suppressed;

  return {
    providerMessageId: messageId,
    recipient,
    status,
    smtpCode: text(payload.delivery?.smtpStatusCode),
    detail,
  };
}

/** The OUT row this provider message id belongs to, if this mailbox sent it. */
async function findOutboundByProviderId(db: D1Database, providerMessageId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM messages WHERE direction = 'OUT' AND provider_message_id = ?1 LIMIT 1`)
    .bind(providerMessageId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export interface DeliveryTally {
  applied: number;
  unmatched: number;
  malformed: number;
}

/**
 * Apply a batch of delivery events. The caller acks per message, so this must distinguish a
 * database failure (worth retrying) from a record it simply cannot use (never worth it).
 *
 * An event that names a message this mailbox never sent is logged with its id, once per batch at
 * most a few times. The count alone was the first design, and it is useless for the one question
 * that matters here: Email Sending's `payload.messageId` is documented as an internal id
 * (`…-msg-…`), while the `send_email` binding hands back the RFC 822 Message-ID it generated. If
 * those never coincide, no event will ever match, and the only way to know that from here is to
 * see the id. It is the owner's own message identifier, already stored in D1 — not mail content.
 */
export async function consumeDeliveryEvents(
  bodies: unknown[],
  env: Env,
  db: D1Database,
): Promise<DeliveryTally> {
  const timer = new Elapsed();
  const tally: DeliveryTally = { applied: 0, unmatched: 0, malformed: 0 };
  let idsLogged = 0;
  for (const body of bodies) {
    const event = parseDeliveryEvent(body);
    if (!event) {
      tally.malformed += 1;
      continue;
    }
    const messageId = await findOutboundByProviderId(db, event.providerMessageId);
    if (!messageId) {
      tally.unmatched += 1;
      if (idsLogged < UNMATCHED_IDS_LOGGED) {
        idsLogged += 1;
        log.warn("delivery_event_unmatched", { providerMessageId: event.providerMessageId, status: event.status });
      }
      continue;
    }
    await applyDeliveryEvent(db, messageId, event);
    tally.applied += 1;
  }
  // Counts only: an SMTP line can name a recipient, and neither belongs in a metric or a log.
  writeMetric(env, "delivery", {
    outcome: tally.applied > 0 ? "applied" : tally.unmatched > 0 ? "unmatched" : "ignored",
    reason: `applied=${tally.applied} unmatched=${tally.unmatched} malformed=${tally.malformed}`,
    commitMs: timer.stop(),
  });
  if (tally.malformed > 0) log.warn("delivery_event_unparsed", { count: tally.malformed });
  return tally;
}

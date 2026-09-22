import { describe, expect, it } from "vitest";
import { SendStatus } from "@mailvault/shared";
import { parseDeliveryEvent } from "../../src/mail/delivery";
import { aggregateStatus } from "../../src/db/recipients";

/*
 * Delivery events arrive from Cloudflare's queue exactly as the platform documents them, so
 * this parser is a contract test against that shape: a field renamed upstream should fail
 * here rather than quietly leave every sent message reading "queued".
 */

/** Detached and loosely typed on purpose: these tests rewrite the payload field by field. */
type Event = { type: string; source?: unknown; metadata?: unknown; payload: Record<string, any> };
const clone = (event: Event): Event => structuredClone(event);

const delivered: Event = {
  type: "cf.email.sending.message.delivered",
  source: { type: "email.sending", zoneId: "z", domain: "send.example.com" },
  payload: {
    eventId: "e1",
    messageId: "0101018f7d0c4d9a-msg-deadbeef",
    sender: "receipts@send.example.com",
    recipient: "User@Example.net",
    subject: "Your receipt",
    terminal: true,
    delivery: {
      status: "delivered",
      provider: "gmail",
      smtpStatusCode: "250",
      smtpResponse: "250 2.0.0 OK",
    },
  },
  metadata: { eventTimestamp: "2026-09-22T02:48:57.132Z" },
};

describe("delivery events", () => {
  it("reads a delivered report and normalises the address", () => {
    expect(parseDeliveryEvent(delivered)).toEqual({
      providerMessageId: "0101018f7d0c4d9a-msg-deadbeef",
      recipient: "user@example.net",
      status: SendStatus.Delivered,
      smtpCode: "250",
      detail: "250 2.0.0 OK",
    });
  });

  it("strips angle brackets, because that is how the sending row stored its id", () => {
    const event = structuredClone(delivered);
    event.payload.messageId = "<0101018f7d0c4d9a-msg-deadbeef>";
    expect(parseDeliveryEvent(event)?.providerMessageId).toBe("0101018f7d0c4d9a-msg-deadbeef");
  });

  it("falls back to the event type when the payload has no status", () => {
    const event = clone(delivered);
    delete event.payload.delivery;
    event.type = "cf.email.sending.message.bounced";
    expect(parseDeliveryEvent(event)?.status).toBe(SendStatus.Bounced);
  });

  it("calls a suppression what it is", () => {
    const event = clone(delivered);
    event.type = "cf.email.sending.message.rejected";
    event.payload.delivery = { status: "rejected", smtpStatusCode: "550" };
    event.payload.rejection = { reason: "recipient is suppressed", party: "recipient", detail: "suppressed: hard bounce" };
    expect(parseDeliveryEvent(event)?.status).toBe(SendStatus.Suppressed);
  });

  it("keeps a plain refusal a refusal", () => {
    const event = clone(delivered);
    event.type = "cf.email.sending.message.rejected";
    event.payload.delivery = { status: "rejected", smtpStatusCode: "550" };
    event.payload.rejection = { reason: "unsubscribed", party: "recipient", detail: "address unsubscribed" };
    expect(parseDeliveryEvent(event)?.status).toBe(SendStatus.Rejected);
  });

  it("ignores anything that is not an event this mailbox can act on", () => {
    expect(parseDeliveryEvent(null)).toBeNull();
    expect(parseDeliveryEvent("nope")).toBeNull();
    expect(parseDeliveryEvent({ type: "cf.r2.object.created" })).toBeNull();
    expect(parseDeliveryEvent({ ...delivered, payload: { recipient: "a@b.example" } })).toBeNull();
    expect(parseDeliveryEvent({ ...delivered, payload: { ...delivered.payload, messageId: "" } })).toBeNull();
    // Neither half names a status we know, so there is nothing to record.
    expect(
      parseDeliveryEvent({
        type: "cf.email.sending.message.quarantined",
        payload: { ...delivered.payload, delivery: { status: "quarantined" } },
      }),
    ).toBeNull();
  });

  it("believes the payload's own status when the event type is one it has not seen", () => {
    // A new event kind with a status this code already understands should still be applied:
    // the status is what the provider concluded, and the type is the wrapper around it.
    const event = {
      ...delivered,
      type: "cf.email.sending.message.delivered_after_retry",
    };
    expect(parseDeliveryEvent(event)?.status).toBe(SendStatus.Delivered);
  });

  it("summarises several destinations as the worst thing that happened", () => {
    expect(aggregateStatus([SendStatus.Delivered, SendStatus.Delivered])).toBe(SendStatus.Delivered);
    expect(aggregateStatus([SendStatus.Delivered, SendStatus.Bounced])).toBe(SendStatus.Bounced);
    // Still outstanding: nothing has gone wrong, and something has yet to answer.
    expect(aggregateStatus([SendStatus.Delivered, SendStatus.Queued])).toBe(SendStatus.Queued);
    expect(aggregateStatus([SendStatus.Delivered, SendStatus.Deferred])).toBe(SendStatus.Deferred);
    // A complaint is not a delivery failure — the mail arrived, and then was reported.
    expect(aggregateStatus([SendStatus.Complained])).toBe(SendStatus.Delivered);
    expect(aggregateStatus([])).toBe(SendStatus.Queued);
  });
});

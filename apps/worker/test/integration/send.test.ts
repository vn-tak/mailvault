import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@cloudflare/workers-types";
import type { Env } from "../../src/env";
import worker from "../../src/index";
import { newId, nowIso } from "../../src/lib/util";
import { getTestBindings, type TestBindings } from "./_mf";

let bindings: TestBindings;
let TEST_ENV: Env;
let DB: D1Database;
let BUCKET: R2Bucket;

const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const j = async (r: Response): Promise<any> => r.json();

/** Everything the binding was asked to send, so a test can assert on the wire request. */
let sent: any[] = [];

/** The binding as it behaves by default: accept, and remember what it was asked to send. */
function acceptingStub(): SendEmail {
  return {
    send: async (message: unknown) => {
      sent.push(message);
      return { messageId: `<wire-${sent.length}@send.example>` };
    },
  } as unknown as SendEmail;
}

beforeAll(async () => {
  bindings = await getTestBindings();
  TEST_ENV = bindings.env as unknown as Env;
  DB = bindings.db;
  BUCKET = bindings.bucket;
});

afterAll(async () => {
  delete TEST_ENV.EMAIL;
  await bindings?.dispose();
});

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, { ...init, headers: { origin: "http://localhost", ...(init.headers ?? {}) } });
}
const H = { "x-mailvault": "1", "content-type": "application/json" };

let domainId = "";
let aliasAddress = "";

async function seed(overrides: { sending?: string; aliasStatus?: string } = {}) {
  // Called again inside a test to change one thing about the setup, so the rows from the
  // first pass have to go — `domains.name` is unique.
  await DB.prepare(`DELETE FROM aliases`).run();
  await DB.prepare(`DELETE FROM domains`).run();
  domainId = newId();
  const local = `out-${domainId.slice(0, 8)}`;
  aliasAddress = `${local}@send.example`;
  await DB.prepare(
    `INSERT INTO domains (id, cloudflare_zone_id, name, zone_status, zone_type, mail_status, sending_status)
     VALUES (?1, ?2, 'send.example', 'active', 'full', 'READY', ?3)`,
  )
    .bind(domainId, `zone-${domainId.slice(0, 8)}`, overrides.sending ?? "ENABLED")
    .run();
  await DB.prepare(`INSERT INTO aliases (id, domain_id, local_part, address, status) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(newId(), domainId, local, aliasAddress, overrides.aliasStatus ?? "ACTIVE")
    .run();
}

async function seedIncoming(over: Partial<{ id: string; provider: string; from: string; subject: string; verdict: string; thread: string }> = {}) {
  const id = over.id ?? newId();
  await DB.prepare(
    `INSERT INTO messages (id, domain_id, alias_id, provider_message_id, dedupe_key, envelope_from, envelope_to,
       header_from, header_to, subject, received_at, raw_r2_key, auth_verdict, direction, thread_root_id, is_read)
     VALUES (?1, ?2, (SELECT id FROM aliases WHERE address = ?3), ?4, ?5, 'billing@shop.example', ?3,
       ?6, ?3, ?7, ?8, ?9, ?10, 'IN', ?11, 1)`,
  )
    .bind(
      id,
      domainId,
      aliasAddress,
      over.provider ?? `${id}@shop.example`,
      `in-${id}`,
      over.from ?? "Billing <billing@shop.example>",
      over.subject ?? "Your invoice",
      nowIso(),
      `seed/${id}.eml`,
      over.verdict ?? "TRUSTED",
      over.thread ?? id,
    )
    .run();
  return id;
}

/** Unfold + decode the `Subject:` encoded-word, as any client would. */
function decodeSubject(raw: string): string {
  const unfolded = raw.replace(/\r\n[ \t]+/g, " ");
  const words = [...unfolded.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].map((m) => m[1]);
  return Buffer.from(words.join(""), "base64").toString("utf8");
}

/** The single text/plain part, base64-decoded. */
function decodeTextPart(raw: string): string {
  const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
  const b64 = body
    .split("\r\n")
    .filter((line) => /^[A-Za-z0-9+/=]+$/.test(line))
    .join("");
  return Buffer.from(b64, "base64").toString("utf8");
}

async function row(id: string) {
  return DB.prepare(`SELECT * FROM messages WHERE id = ?1`).bind(id).first<any>();
}

beforeEach(async () => {
  sent = [];
  TEST_ENV.EMAIL = acceptingStub();
  await DB.prepare(`DELETE FROM messages`).run();
  await DB.prepare(`DELETE FROM aliases`).run();
  await DB.prepare(`DELETE FROM domains`).run();
  await DB.prepare(`DELETE FROM messages_fts`).run();
  await seed();
});

describe("sending from an alias", () => {
  it("refuses an address that is not one of the owner's aliases", async () => {
    const res = await worker.fetch(
      req("/api/outbox", { method: "POST", headers: H, body: JSON.stringify({ fromAddress: "someone@example.com", to: ["a@b.example"], text: "hi" }) }),
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("UNKNOWN_SENDER");
    expect(sent).toHaveLength(0);
  });

  it("refuses a disabled alias, the same gate that refuses to receive for it", async () => {
    await seed({ aliasStatus: "DISABLED" });
    const res = await worker.fetch(
      req("/api/outbox", { method: "POST", headers: H, body: JSON.stringify({ fromAddress: aliasAddress, to: ["a@b.example"], text: "hi" }) }),
      TEST_ENV,
      CTX,
    );
    expect((await j(res)).error.code).toBe("UNKNOWN_SENDER");
  });

  it("refuses a domain that receives but has not been enabled for sending", async () => {
    await seed({ sending: "DISABLED" });
    const res = await worker.fetch(
      req("/api/outbox", { method: "POST", headers: H, body: JSON.stringify({ fromAddress: aliasAddress, to: ["a@b.example"], text: "hi" }) }),
      TEST_ENV,
      CTX,
    );
    expect((await j(res)).error.code).toBe("SENDING_DISABLED");
    expect(sent).toHaveLength(0);
  });

  it("says so when the deployment cannot send at all, rather than failing obscurely", async () => {
    delete TEST_ENV.EMAIL;
    const res = await worker.fetch(
      req("/api/outbox", { method: "POST", headers: H, body: JSON.stringify({ fromAddress: aliasAddress, to: ["a@b.example"], text: "hi" }) }),
      TEST_ENV,
      CTX,
    );
    expect((await j(res)).error.code).toBe("BINDING_MISSING");
    // The attempt is still recorded: a message that did not go should be visible as one that
    // did not go, not vanish because the transport was missing.
    const rows = await DB.prepare(`SELECT send_status, send_error FROM messages WHERE direction = 'OUT'`).all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].send_status).toBe("FAILED");
    expect(rows.results[0].send_error).toContain("BINDING_MISSING");
  });

  it("checks every policy before it notices the transport is missing", async () => {
    const parentId = await seedIncoming({ verdict: "SPOOFED" });
    delete TEST_ENV.EMAIL;
    const res = await worker.fetch(
      req(`/api/messages/${parentId}/reply`, { method: "POST", headers: H, body: JSON.stringify({ text: "ok" }) }),
      TEST_ENV,
      CTX,
    );
    // "This server cannot send" must never be the stated reason for a reply that should not
    // have been allowed at all.
    expect((await j(res)).error.code).toBe("SPOOFED_PARENT");
  });

  it("stores the message it sent, addressed to who it went to", async () => {
    const res = await worker.fetch(
      req("/api/outbox", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ fromAddress: aliasAddress, to: ["customer@example.com"], subject: "Chốt đơn", text: "Cảm ơn bạn!" }),
      }),
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(201);
    const outcome = await j(res);
    const stored = await row(outcome.id);

    expect(stored.direction).toBe("OUT");
    expect(stored.is_read).toBe(1);
    expect(stored.send_status).toBe("QUEUED");
    // Stored bare, exactly like a received Message-ID, because threading matches the two.
    expect(stored.provider_message_id).toBe("wire-1@send.example");
    expect(stored.header_to).toBe("customer@example.com");
    expect(stored.alias_id).toBeTruthy();
    // Sent mail is its own conversation until something answers it.
    expect(stored.thread_root_id).toBe(outcome.id);
    // It reads as the owner's outgoing note, not as mail somebody sent to the mailbox.
    expect(stored.auth_verdict).toBe("TRUSTED");

    const raw = await BUCKET.get(stored.raw_r2_key);
    const text = await raw!.text();
    expect(text).toContain(`From: ${aliasAddress}`);
    expect(text).toContain("To: customer@example.com");
    expect(text).toContain("Subject: =?UTF-8?B?");
    expect(text).toContain("Content-Type: text/plain; charset=utf-8");
    // The point of base64 parts is that nothing is lost on the way back.
    expect(decodeSubject(text)).toBe("Chốt đơn");
    expect(decodeTextPart(text)).toBe("Cảm ơn bạn!");
    expect(text).toMatch(/\r\n$/);

    const parsed = await (await BUCKET.get(stored.parsed_r2_key))!.json();
    expect(parsed).toMatchObject({ text: "Cảm ơn bạn!" });
  });

  it("keeps Cc visible and Bcc out of the stored record", async () => {
    const res = await worker.fetch(
      req("/api/outbox", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ fromAddress: aliasAddress, to: ["a@b.example"], cc: ["c@d.example"], bcc: ["secret@e.example"], text: "hi", subject: "s" }),
      }),
      TEST_ENV,
      CTX,
    );
    const stored = await row((await j(res)).id);
    expect(stored.cc).toBe("c@d.example");
    expect(stored.header_to).toBe("a@b.example, c@d.example");
    // The envelope carries the hidden recipient; the message that is stored and downloaded
    // must not name them.
    expect(stored.envelope_to).toContain("secret@e.example");
    expect((await (await BUCKET.get(stored.raw_r2_key))!.text())).not.toContain("secret@e.example");
    expect(sent[0].bcc).toEqual(["secret@e.example"]);
  });

  it("collapses the same recipient written twice, in any of the three spellings", async () => {
    const res = await worker.fetch(
      req("/api/outbox", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ fromAddress: aliasAddress, to: ["a@b.example", "A@b.example ", aliasAddress], text: "hi" }),
      }),
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(201);
    // Same spelling twice collapses; the owner's own alias stays, because writing a note to
    // yourself is a thing people do.
    expect(sent[0].to).toEqual(["a@b.example", aliasAddress]);
    // The same person in Cc is not asked for twice.
    const twice = await worker.fetch(
      req("/api/outbox", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ fromAddress: aliasAddress, to: ["x@y.example"], cc: ["X@y.example", "z@w.example"], text: "hi" }),
      }),
      TEST_ENV,
      CTX,
    );
    expect(twice.status).toBe(201);
    expect(sent[1].cc).toEqual(["z@w.example"]);
  });

  it("still delivers a note the owner writes to their own alias", async () => {
    const res = await worker.fetch(
      req("/api/outbox", { method: "POST", headers: H, body: JSON.stringify({ fromAddress: aliasAddress, to: [aliasAddress], text: "self note" }) }),
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(201);
  });

  it("stops at its own daily budget, because Cloudflare's counter is not realtime", async () => {
    TEST_ENV.MAX_SENDS_PER_DAY = "1";
    const body = JSON.stringify({ fromAddress: aliasAddress, to: ["a@b.example"], text: "hi" });
    const first = await worker.fetch(req("/api/outbox", { method: "POST", headers: H, body }), TEST_ENV, CTX);
    expect(first.status).toBe(201);
    const second = await worker.fetch(req("/api/outbox", { method: "POST", headers: H, body }), TEST_ENV, CTX);
    expect((await j(second)).error.code).toBe("DAILY_LIMIT");
    expect(sent).toHaveLength(1);
    delete TEST_ENV.MAX_SENDS_PER_DAY;
  });

  it("reports the transport's refusal as the message's state, not as a lost send", async () => {
    TEST_ENV.EMAIL = {
      send: async () => {
        throw Object.assign(new Error("recipient is suppressed"), { code: "E_RECIPIENT_SUPPRESSED" });
      },
    } as unknown as SendEmail;
    const res = await worker.fetch(
      req("/api/outbox", { method: "POST", headers: H, body: JSON.stringify({ fromAddress: aliasAddress, to: ["gone@b.example"], text: "hi" }) }),
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("E_RECIPIENT_SUPPRESSED");
    // The record stays, marked with what happened, so the owner can see it never went.
    const rows = await DB.prepare(`SELECT send_status, send_error FROM messages WHERE direction = 'OUT'`).all<any>();
    expect(rows.results[0].send_status).toBe("SUPPRESSED");
    expect(rows.results[0].send_error).toContain("E_RECIPIENT_SUPPRESSED");
  });
});

describe("replying inside a conversation", () => {
  it("answers the sender of the message, from the alias it arrived on, in the same thread", async () => {
    const parentId = await seedIncoming({ from: "Billing <billing@shop.example>" });
    const res = await worker.fetch(
      req(`/api/messages/${parentId}/reply`, { method: "POST", headers: H, body: JSON.stringify({ text: "Where is my invoice?" }) }),
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(201);
    const reply = await row((await j(res)).id);

    expect(reply.direction).toBe("OUT");
    expect(reply.alias_id).toBe((await row(parentId)).alias_id);
    expect(reply.thread_root_id).toBe(parentId);
    expect(reply.subject).toBe("Re: Your invoice");
    expect(reply.header_to).toBe("billing@shop.example");
    expect(reply.in_reply_to).toBe((await row(parentId)).provider_message_id);
    expect(sent[0].headers["In-Reply-To"]).toBe(`<${reply.in_reply_to}>`);
  });

  it("prefers Reply-To over From, because that is the address the author asked for answers", async () => {
    const parentId = await seedIncoming({ from: "Newsletter <no-answer@shop.example>" });
    await DB.prepare(`UPDATE messages SET reply_to = 'help@shop.example' WHERE id = ?1`).bind(parentId).run();
    await worker.fetch(req(`/api/messages/${parentId}/reply`, { method: "POST", headers: H, body: JSON.stringify({ text: "hello" }) }), TEST_ENV, CTX);
    expect(sent[0].to).toEqual(["help@shop.example"]);
  });

  it("continues a thread when the arriving message quotes the reply rather than the original", async () => {
    const root = await seedIncoming();
    const replyId = await (async () => {
      const res = await worker.fetch(req(`/api/messages/${root}/reply`, { method: "POST", headers: H, body: JSON.stringify({ text: "hi" }) }), TEST_ENV, CTX);
      return (await j(res)).id;
    })();
    const quoted = (await row(replyId)).provider_message_id;

    // The shop answers the reply. Its References name the reply, not the first message.
    const inbound = new TextEncoder().encode(
      [
        "From: Billing <billing@shop.example>",
        `To: ${aliasAddress}`,
        "Subject: Re: Your invoice",
        "Message-ID: <answer-2@shop.example>",
        `In-Reply-To: <${quoted}>`,
        `References: <${(await row(root)).provider_message_id}> <${quoted}>`,
        "",
        "Attached now.",
        "",
      ].join("\r\n"),
    );
    const message = {
      from: "billing@shop.example",
      to: aliasAddress,
      headers: new Headers(),
      raw: new Response(inbound).body as ReadableStream<Uint8Array>,
      rawSize: inbound.byteLength,
      setReject: () => {},
    };
    const { ingestEmail } = await import("../../src/mail/ingest");
    const result = await ingestEmail(message, TEST_ENV, DB, BUCKET);
    expect(result.status).toBe("stored");

    const answered = await DB.prepare(`SELECT id, thread_root_id FROM messages WHERE provider_message_id = 'answer-2@shop.example'`).first<any>();
    expect(answered.thread_root_id).toBe(root);

    const thread = await j(await worker.fetch(req(`/api/threads/${root}`), TEST_ENV, CTX));
    expect(thread.items.map((m: any) => m.direction)).toEqual(["IN", "OUT", "IN"]);
  });

  it("will not answer a message whose sender failed authentication", async () => {
    const parentId = await seedIncoming({ verdict: "SPOOFED" });
    const res = await worker.fetch(
      req(`/api/messages/${parentId}/reply`, { method: "POST", headers: H, body: JSON.stringify({ text: "ok" }) }),
      TEST_ENV,
      CTX,
    );
    expect((await j(res)).error.code).toBe("SPOOFED_PARENT");
    expect(sent).toHaveLength(0);
  });

  it("does not let the request choose who is answered or who answers", async () => {
    const parentId = await seedIncoming();
    const res = await worker.fetch(
      req(`/api/messages/${parentId}/reply`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ text: "hi", to: ["victim@other.example"], fromAddress: "victim@other.example" }),
      }),
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(201);
    expect(sent[0].to).toEqual(["billing@shop.example"]);
    expect(sent[0].from).toBe(aliasAddress);
  });
});

describe("listing received and sent mail", () => {
  async function compose() {
    const res = await worker.fetch(
      req("/api/outbox", { method: "POST", headers: H, body: JSON.stringify({ fromAddress: aliasAddress, to: ["a@b.example"], subject: "Sent note", text: "hi" }) }),
      TEST_ENV,
      CTX,
    );
    return j(res);
  }

  it("shows only received mail by default, which is what an inbox is", async () => {
    const parentId = await seedIncoming();
    await compose();
    const items = (await j(await worker.fetch(req("/api/messages"), TEST_ENV, CTX))).items;
    expect(items.map((m: any) => m.id)).toEqual([parentId]);
  });

  it("shows sent mail when asked, carrying its delivery state", async () => {
    await seedIncoming();
    const outcome = await compose();
    const items = (await j(await worker.fetch(req("/api/messages?direction=out"), TEST_ENV, CTX))).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: outcome.id, direction: "OUT", sendStatus: "QUEUED", aliasAddress });
  });

  it("finds sent mail by who it went to", async () => {
    await compose();
    const items = (await j(await worker.fetch(req("/api/messages?direction=out&q=customer"), TEST_ENV, CTX))).items;
    expect(items).toHaveLength(0);
    const found = (await j(await worker.fetch(req("/api/messages?direction=out&q=b.example"), TEST_ENV, CTX))).items;
    expect(found).toHaveLength(1);
  });

  it("reports which domains may be used as a sender, and the budget left", async () => {
    await seedIncoming();
    await compose();
    const caps = await j(await worker.fetch(req("/api/outbox/capabilities"), TEST_ENV, CTX));
    expect(caps.canCompose).toBe(true);
    expect(caps.domains[0]).toMatchObject({ name: "send.example", canSend: true });
    expect(caps.sent).toBe(1);
    expect(caps.remaining).toBe(caps.limit - 1);
  });

  it("deletes a sent message's stored copy along with its row", async () => {
    const outcome = await compose();
    const stored = await row(outcome.id);
    const res = await worker.fetch(req(`/api/messages/${outcome.id}`, { method: "DELETE", headers: { "x-mailvault": "1" } }), TEST_ENV, CTX);
    expect(res.status).toBe(200);
    expect(await row(outcome.id)).toBeFalsy();
    expect(await BUCKET.get(stored.raw_r2_key)).toBeNull();
  });
});

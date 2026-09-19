import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/env";
import { ingestEmail } from "../../src/mail/ingest";
import { getTestBindings, type TestBindings } from "./_mf";

let bindings: TestBindings;
let TEST_ENV: Env;
let DB: D1Database;
let BUCKET: R2Bucket;

beforeAll(async () => {
  bindings = await getTestBindings();
  TEST_ENV = bindings.env;
  DB = bindings.db;
  BUCKET = bindings.bucket;
});

afterAll(async () => {
  await bindings?.dispose();
});

function emailRaw(opts: { subject: string; messageId: string; body: string; to: string }): Uint8Array {
  const mime = [
    "From: GitHub <noreply@github.com>",
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Message-ID: <${opts.messageId}@github.com>`,
    "Date: Fri, 19 Sep 2026 12:00:00 +0000",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.body,
    "",
  ].join("\r\n");
  return new TextEncoder().encode(mime);
}

function makeMessage(to: string, raw: Uint8Array) {
  const rejects: string[] = [];
  const message = {
    from: "noreply@github.com",
    to,
    headers: new Headers(),
    raw: new Response(raw).body as ReadableStream<Uint8Array>,
    rawSize: raw.byteLength,
    setReject(reason: string) {
      rejects.push(reason);
    },
  };
  return { message, rejects };
}

async function seedAlias(address: string, status: "ACTIVE" | "DISABLED" = "ACTIVE") {
  const domainId = crypto.randomUUID();
  const [local, domain] = address.split("@");
  await DB.prepare(
    `INSERT INTO domains (id, cloudflare_zone_id, name, zone_status, zone_type, mail_status)
     VALUES (?1, ?2, ?3, 'active', 'full', 'READY')`,
  )
    .bind(domainId, `zone-${domain}-${domainId.slice(0, 6)}`, domain)
    .run();
  await DB.prepare(
    `INSERT INTO aliases (id, domain_id, local_part, address, status) VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), domainId, local, address, status)
    .run();
  return domainId;
}

async function countMessages(): Promise<number> {
  const r = await DB.prepare(`SELECT COUNT(*) AS c FROM messages`).first<{ c: number }>();
  return Number(r?.c ?? 0);
}

beforeEach(async () => {
  await DB.prepare(`DELETE FROM attachments`).run();
  await DB.prepare(`DELETE FROM messages`).run();
  await DB.prepare(`DELETE FROM aliases`).run();
  await DB.prepare(`DELETE FROM provisioning_events`).run();
  await DB.prepare(`DELETE FROM domains`).run();
});

describe("inbound email ingestion", () => {
  it("stores mail for an ACTIVE alias and extracts the OTP", async () => {
    await seedAlias("github-x7k2@notify.example");
    const { message } = makeMessage(
      "github-x7k2@notify.example",
      emailRaw({ subject: "Your code", body: "Your GitHub verification code is 593821.", messageId: "m1", to: "github-x7k2@notify.example" }),
    );

    const result = await ingestEmail(message, TEST_ENV, DB, BUCKET);
    expect(result.status).toBe("stored");
    expect(await countMessages()).toBe(1);

    const row = await DB.prepare(`SELECT raw_r2_key, extracted_codes_json FROM messages`).first<{
      raw_r2_key: string;
      extracted_codes_json: string;
    }>();
    expect(row?.extracted_codes_json).toContain("593821");
    const rawObj = await BUCKET.get(row!.raw_r2_key);
    expect(rawObj).toBeTruthy();
    const text = await new Response(rawObj!.body as ReadableStream).text();
    expect(text).toContain("593821");
  });

  it("rejects unknown recipients and never auto-creates an alias", async () => {
    const { message, rejects } = makeMessage(
      "who-is-this@notify.example",
      emailRaw({ subject: "hi", body: "hello", messageId: "m2", to: "who-is-this@notify.example" }),
    );
    const result = await ingestEmail(message, TEST_ENV, DB, BUCKET);
    expect(result).toMatchObject({ status: "rejected", reason: "unknown_recipient" });
    expect(rejects.length).toBeGreaterThan(0);
    expect(await countMessages()).toBe(0);
    const alias = await DB.prepare(`SELECT 1 AS x FROM aliases WHERE address='who-is-this@notify.example'`).first();
    expect(alias).toBeNull();
  });

  it("rejects mail to a DISABLED alias while keeping its history", async () => {
    await seedAlias("off@notify.example", "DISABLED");
    const { message } = makeMessage("off@notify.example", emailRaw({ subject: "x", body: "y", messageId: "m3", to: "off@notify.example" }));
    const result = await ingestEmail(message, TEST_ENV, DB, BUCKET);
    expect(result.status).toBe("rejected");
    expect(await countMessages()).toBe(0);
  });

  it("dedupes the same event redelivered twice", async () => {
    await seedAlias("dup@notify.example");
    const raw = emailRaw({ subject: "dup", body: "code 112233", messageId: "m4", to: "dup@notify.example" });
    const first = await ingestEmail(makeMessage("dup@notify.example", raw).message, TEST_ENV, DB, BUCKET);
    const second = await ingestEmail(makeMessage("dup@notify.example", raw).message, TEST_ENV, DB, BUCKET);
    expect(first.status).toBe("stored");
    expect(second.status).toBe("duplicate");
    expect(await countMessages()).toBe(1);
  });

  it("rejects messages over the configured size cap", async () => {
    await seedAlias("big@notify.example");
    const smallEnv = { ...TEST_ENV, MAX_MESSAGE_BYTES: "32" } as Env;
    const raw = emailRaw({ subject: "big", body: "x".repeat(5000), messageId: "m5", to: "big@notify.example" });
    const { message, rejects } = makeMessage("big@notify.example", raw);
    const result = await ingestEmail(message, smallEnv, DB, BUCKET);
    expect(result).toMatchObject({ status: "rejected", reason: "too_large" });
    expect(rejects.length).toBeGreaterThan(0);
    expect(await countMessages()).toBe(0);
  });
});

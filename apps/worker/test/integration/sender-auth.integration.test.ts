import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Env } from "../../src/env";
import { ingestEmail } from "../../src/mail/ingest";
import { getTestBindings, type TestBindings } from "./_mf";

let bindings: TestBindings;
let env: Env;
let db: D1Database;
let bucket: R2Bucket;

beforeAll(async () => {
  bindings = await getTestBindings();
  env = bindings.env;
  db = bindings.db;
  bucket = bindings.bucket;
});

afterAll(async () => {
  await bindings?.dispose();
});

beforeEach(async () => {
  await db.prepare("DELETE FROM attachments").run();
  await db.prepare("DELETE FROM messages").run();
  await db.prepare("DELETE FROM aliases").run();
  await db.prepare("DELETE FROM domains").run();
});

async function seedAlias(address: string, policy: "WARN" | "REJECT" = "WARN"): Promise<void> {
  const domainId = crypto.randomUUID();
  const [localPart, domain] = address.split("@");
  await db
    .prepare(
      `INSERT INTO domains (id, cloudflare_zone_id, name, zone_status, zone_type, mail_status, auth_policy)
       VALUES (?1, ?2, ?3, 'active', 'full', 'READY', ?4)`,
    )
    .bind(domainId, `zone-${domain}-${domainId.slice(0, 6)}`, domain, policy)
    .run();
  await db
    .prepare(
      "INSERT INTO aliases (id, domain_id, local_part, address, status) VALUES (?1, ?2, ?3, ?4, 'ACTIVE')",
    )
    .bind(crypto.randomUUID(), domainId, localPart, address)
    .run();
}

function message(to: string, authResult: string, authHeader = "Authentication-Results") {
  const raw = new TextEncoder().encode(
    [
      "From: Security <security@example.com>",
      `To: ${to}`,
      "Subject: Account notification",
      "Message-ID: <sender-auth@example.com>",
      "Date: Fri, 19 Sep 2026 12:00:00 +0000",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      `${authHeader}: ${authResult}`,
      "",
      "Your verification code is 123456.",
      "",
    ].join("\r\n"),
  );
  return {
    from: "bounce@attacker.invalid",
    to,
    headers: new Headers(),
    raw: new Response(raw).body as ReadableStream<Uint8Array>,
    rawSize: raw.byteLength,
    setReject() {},
  };
}

describe("sender authentication provenance through Miniflare ingest", () => {
  it("revokes historical inbound auth verdicts and evidence without changing outbound mail", async () => {
    await seedAlias("history@notify.example");
    const domain = await db
      .prepare("SELECT id FROM domains WHERE name = 'notify.example'")
      .first<{ id: string }>();
    expect(domain).not.toBeNull();

    await db.batch([
      db
        .prepare(
          `INSERT INTO messages (id, domain_id, dedupe_key, received_at, raw_r2_key, direction, auth_verdict, auth_json)
           VALUES ('old-trusted', ?1, 'old-trusted', '2026-01-01T00:00:00.000Z', 'old/trusted.eml', 'IN', 'TRUSTED', '{"source":"message-header"}')`,
        )
        .bind(domain!.id),
      db
        .prepare(
          `INSERT INTO messages (id, domain_id, dedupe_key, received_at, raw_r2_key, direction, auth_verdict, auth_json)
           VALUES ('old-spoofed', ?1, 'old-spoofed', '2026-01-01T00:00:00.000Z', 'old/spoofed.eml', 'IN', 'SPOOFED', '{"source":"message-header"}')`,
        )
        .bind(domain!.id),
      db
        .prepare(
          `INSERT INTO messages (id, domain_id, dedupe_key, received_at, raw_r2_key, direction, auth_verdict, auth_json)
           VALUES ('sent-trusted', ?1, 'sent-trusted', '2026-01-01T00:00:00.000Z', 'old/sent.eml', 'OUT', 'TRUSTED', '{"source":"outbound"}')`,
        )
        .bind(domain!.id),
    ]);

    const migration = readFileSync(
      new URL("../../migrations/0016_revoke_legacy_sender_auth.sql", import.meta.url),
      "utf8",
    );
    const sql = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    await db.prepare(sql).run();

    const rows = await db
      .prepare("SELECT id, direction, auth_verdict, auth_json FROM messages ORDER BY id")
      .all<{ id: string; direction: string; auth_verdict: string; auth_json: string | null }>();
    expect(rows.results).toEqual([
      { id: "old-spoofed", direction: "IN", auth_verdict: "UNVERIFIED", auth_json: null },
      { id: "old-trusted", direction: "IN", auth_verdict: "UNVERIFIED", auth_json: null },
      {
        id: "sent-trusted",
        direction: "OUT",
        auth_verdict: "TRUSTED",
        auth_json: '{"source":"outbound"}',
      },
    ]);
  });

  it("stores a forged aligned pass as UNVERIFIED", async () => {
    const to = "aligned@notify.example";
    await seedAlias(to);

    const result = await ingestEmail(
      message(
        to,
        "attacker.invalid; dkim=pass header.d=example.com; dmarc=pass header.from=example.com",
      ),
      env,
      db,
      bucket,
    );

    expect(result).toMatchObject({ status: "stored", verdict: "UNVERIFIED" });
    const row = await db
      .prepare("SELECT auth_verdict FROM messages")
      .first<{ auth_verdict: string }>();
    expect(row?.auth_verdict).toBe("UNVERIFIED");
  });

  it("does not trust an aligned pass from Authentication-Results-IANA either", async () => {
    const to = "iana-aligned@notify.example";
    await seedAlias(to);

    const result = await ingestEmail(
      message(
        to,
        "attacker.invalid; dkim=pass header.d=example.com; dmarc=pass header.from=example.com",
        "Authentication-Results-IANA",
      ),
      env,
      db,
      bucket,
    );

    expect(result).toMatchObject({ status: "stored", verdict: "UNVERIFIED" });
    const row = await db
      .prepare("SELECT auth_verdict FROM messages")
      .first<{ auth_verdict: string }>();
    expect(row?.auth_verdict).toBe("UNVERIFIED");
  });

  it("does not reject based on a forged DMARC failure, even under REJECT policy", async () => {
    const to = "forged-fail@notify.example";
    await seedAlias(to, "REJECT");

    const result = await ingestEmail(
      message(to, "attacker.invalid; dmarc=fail header.from=example.com"),
      env,
      db,
      bucket,
    );

    expect(result).toMatchObject({ status: "stored", verdict: "UNVERIFIED" });
    const row = await db
      .prepare("SELECT auth_verdict FROM messages")
      .first<{ auth_verdict: string }>();
    expect(row?.auth_verdict).toBe("UNVERIFIED");
  });
});

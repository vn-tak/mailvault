import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Env } from "../../src/env";
import { ingestEmail, stageEmail } from "../../src/mail/ingest";
import worker from "../../src/index";
import { getTestBindings, type TestBindings } from "./_mf";
import { createDkimKey, signMessage } from "../compat/dkim-fixtures";

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

function message(
  to: string,
  authResult: string,
  authHeader = "Authentication-Results",
  headerFrom = "Security <security@example.com>",
) {
  const raw = new TextEncoder().encode(
    [
      `From: ${headerFrom}`,
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
  return envelope(to, raw);
}

function envelope(to: string, raw: Uint8Array) {
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

  it("does not treat a valid DKIM signature in the message as verified evidence", async () => {
    const to = "dkim-signed@notify.example";
    await seedAlias(to);
    const raw = signMessage(createDkimKey("rsa-sha256", "sel", "example.com"), {
      headers: [
        "From: Security <security@example.com>",
        `To: ${to}`,
        "Subject: Account notification",
        "Message-ID: <dkim-signed@example.com>",
        "Date: Fri, 19 Sep 2026 12:00:00 +0000",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
      ],
      body: "Your verification code is 123456.\r\n",
    });

    const result = await ingestEmail(envelope(to, new TextEncoder().encode(raw)), env, db, bucket);

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

  it.each([
    [
      "aligned receiver name",
      "Authentication-Results",
      "cloudflare.com; dkim=pass header.d=target.example; dmarc=pass header.from=target.example",
    ],
    [
      "mixed casing",
      "aUtHeNtIcAtIoN-rEsUlTs",
      "cloudflare.com; dkim=pass header.d=target.example; dmarc=pass header.from=target.example",
    ],
    [
      "folded header",
      "Authentication-Results",
      "cloudflare.com;\r\n dkim=pass header.d=target.example;\r\n dmarc=pass header.from=target.example",
    ],
    [
      "duplicate headers",
      "Authentication-Results",
      "cloudflare.com; dkim=pass header.d=target.example\r\nAuthentication-Results: cloudflare.com; dmarc=pass header.from=target.example",
    ],
  ])("keeps forged receiver results observational: %s", async (_name, header, result) => {
    const to = "receiver-forgery@notify.example";
    await seedAlias(to);
    const stored = await ingestEmail(
      message(to, result, header, "security@target.example"),
      env,
      db,
      bucket,
    );

    expect(stored).toMatchObject({ status: "stored", verdict: "UNVERIFIED" });
    const row = await db
      .prepare("SELECT auth_verdict, auth_json FROM messages")
      .first<{ auth_verdict: string; auth_json: string }>();
    expect(row?.auth_verdict).toBe("UNVERIFIED");
    const auth = JSON.parse(row!.auth_json);
    expect(auth.evidence.length).toBeGreaterThan(0);
    expect(auth.evidence.every((item: { aligned: boolean }) => item.aligned)).toBe(true);
    expect(auth.alignedPass).toEqual({ spf: false, dkim: false, dmarc: false });
  });

  it("preserves UNVERIFIED across partial commit, queue retry and replay", async () => {
    const to = "receiver-retry@notify.example";
    await seedAlias(to);
    const staged = await stageEmail(
      message(
        to,
        "cloudflare.com; dkim=pass header.d=target.example; dmarc=pass header.from=target.example",
        "Authentication-Results",
        "security@target.example",
      ),
      env,
      db,
      bucket,
    );
    expect(staged.status).toBe("staged");
    if (staged.status !== "staged") throw new Error("expected_staged_message");
    const job = staged.job;
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => void promise.catch(() => undefined),
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext;
    async function deliver(attempts: number) {
      const decisions: string[] = [];
      await worker.queue(
        {
          queue: "mail-ingest",
          messages: [
            {
              id: "sender-auth-retry",
              timestamp: new Date(),
              attempts,
              body: job,
              ack: () => void decisions.push("ack"),
              retry: () => void decisions.push("retry"),
            },
          ],
          ackAll: () => undefined,
          retryAll: () => undefined,
        } as never,
        env,
        ctx,
      );
      return decisions;
    }
    const storedAuth = () =>
      db
        .prepare("SELECT auth_verdict, auth_json, ingest_status FROM messages WHERE id = ?1")
        .bind(job.messageId)
        .first<{ auth_verdict: string; auth_json: string; ingest_status: string | null }>();

    await db
      .prepare(
        `CREATE TRIGGER sender_auth_fail_core BEFORE UPDATE OF ingest_status ON messages
       BEGIN SELECT RAISE(FAIL, 'sender_auth_partial_commit'); END`,
      )
      .run();
    let partial;
    try {
      expect(await deliver(1)).toEqual(["retry"]);
      partial = await storedAuth();
      expect(partial).toMatchObject({ auth_verdict: "UNVERIFIED", ingest_status: null });
      expect(await bucket.head(job.rawKey)).not.toBeNull();
      expect(await bucket.head(job.parsedKey)).not.toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER sender_auth_fail_core").run();
    }

    expect(await deliver(2)).toEqual(["ack"]);
    const completed = await storedAuth();
    expect(completed).toMatchObject({
      auth_verdict: "UNVERIFIED",
      auth_json: partial!.auth_json,
      ingest_status: "COMMITTED",
    });
    expect(await deliver(3)).toEqual(["ack"]);
    expect(await storedAuth()).toEqual(completed);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM messages").first()).toEqual({
      count: 1,
    });
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

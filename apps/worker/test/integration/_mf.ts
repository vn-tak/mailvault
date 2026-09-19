import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import type { Env } from "../../src/env";

/**
 * Test harness. The Cloudflare vitest pool cannot boot from a project path that
 * contains spaces (workerd mis-resolves its own vitest shim), so integration tests
 * run under plain Node and talk to real D1 + R2 through a programmatic Miniflare
 * instance instead. Only the storage bindings come from workerd; application code
 * (Hono handlers, postal-mime, jose) executes in the Node test process exactly as it
 * would in the isolate.
 */
export interface TestBindings {
  env: Env;
  db: D1Database;
  bucket: R2Bucket;
  dispose: () => Promise<void>;
}

let cached: TestBindings | undefined;

function loadSchema(): string[] {
  const raw = readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8");
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^PRAGMA/i.test(s));
}

export async function getTestBindings(): Promise<TestBindings> {
  if (cached) return cached;

  const mf = new Miniflare({
    script: `export default { fetch(){ return new Response("ok"); } }`,
    modules: true,
    compatibilityDate: "2024-12-30",
    d1Databases: { DB: "mail-vault-db-test" },
    r2Buckets: { MAIL_BUCKET: "mail-vault-storage-test" },
  });

  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const bucket = (await mf.getR2Bucket("MAIL_BUCKET")) as unknown as R2Bucket;

  const statements = loadSchema();
  await db.batch(statements.map((sql) => db.prepare(sql)));

  const env = {
    DB: db,
    MAIL_BUCKET: bucket,
    ASSETS: {},
    ENVIRONMENT: "test",
    DEV_AUTH_BYPASS: "true",
    MAX_MESSAGE_BYTES: "20971520",
    MAIL_WORKER_NAME: "mail-vault",
    APP_ORIGIN: "http://localhost",
    CF_ACCOUNT_ID: "test-account",
    CF_ACCESS_TEAM_DOMAIN: "https://test-team.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    ALLOWED_EMAILS: "",
  } as unknown as Env;

  const created: TestBindings = { env, db, bucket, dispose: async () => void (await mf.dispose()) };
  cached = created;
  return created;
}

import type { Env } from "./env";
import type {
  ExportedHandler,
  ExecutionContext,
  ForwardableEmailMessage,
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";
import { createCloudflareClient } from "./cf/api-client";
import { createApp } from "./app";
import { decorateResponse } from "./security/headers";
import { stageEmail, commitIngest, type IngestJob } from "./mail/ingest";
import { deleteKeys } from "./storage/r2";
import { pushToAll } from "./push";
import { log } from "./lib/logging";
import { runWatchdog } from "./provisioning/watchdog";

// One router instance per isolate is safe: Hono is stateless and env is per-request.
const app = createApp();

export default {
  /**
   * HTTP: `/api/*` is served by the authenticated router; every other path falls
   * through to Workers Static Assets (the SPA), which handles its own routing.
   * Responses are hardened with security headers here so errors and assets included.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const res = await app.fetch(request, env, ctx);
      return decorateResponse(env, request.url, res);
    }
    const assetRes = await env.ASSETS.fetch(request);
    return decorateResponse(env, request.url, assetRes);
  },

  /**
   * Incoming mail from a Cloudflare Email Routing catch-all rule. Acceptance is
   * gated on an ACTIVE alias in D1; unknown recipients are rejected (never
   * auto-created). Startup/deploy performs no domain mutation (section 9).
   *
   * This handler stages (parse + write R2) and hands the metadata commit to the queue.
   * A throw before the hand-off means nothing was durably written, so Cloudflare's own
   * delivery retry starts clean; after it, the message is safe in R2 either way.
   */
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    try {
      const staged = await stageEmail(message, env, env.DB, env.MAIL_BUCKET);
      if (staged.status !== "staged") return;
      try {
        await env.MAIL_INGEST_QUEUE.send(staged.job);
      } catch (err) {
        // The job never reached the queue, so the staged objects would be orphans with
        // nothing pointing at them. Remove them and let delivery retry from the top.
        await deleteKeys(env.MAIL_BUCKET, staged.keys);
        throw err;
      }
    } catch (err) {
      // Rejected for retry; log without body/token (section 34). The throw is deliberate.
      log.error("email_handler_failed", { error: err instanceof Error ? err.message : "error" });
      throw err;
    }
  },

  /**
   * Commit staged messages to D1. This is the part that used to be able to lose a
   * message: a transient database failure inside the email handler had no retry of its
   * own. Here a failure re-delivers the job with the R2 objects untouched, and after the
   * consumer's retry budget the job parks in the dead-letter queue — still recoverable,
   * because the job carries keys only, never content.
   */
  async queue(batch: MessageBatch<IngestJob>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        const result = await commitIngest(message.body, env.DB, env.MAIL_BUCKET);
        if (result.status === "stored") {
          // Notify only after the mail is durable, and detached: a slow or dead push
          // endpoint must never affect delivery or make the message retry.
          ctx.waitUntil(pushToAll(env, env.DB).then(() => undefined));
        }
        message.ack();
      } catch (err) {
        log.error("ingest_commit_failed", {
          attempt: message.attempts,
          error: err instanceof Error ? err.message : "error",
        });
        message.retry();
      }
    }
  },

  /**
   * Drift check. Cloudflare config can be changed from the dashboard by anyone, and then
   * mail silently stops arriving. This re-reads only what MailVault already believes
   * works and updates its own rows — it never enables routing, edits DNS or touches a
   * zone (section 9: no automatic domain mutation).
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    void ctx;
    const token = env.CLOUDFLARE_API_TOKEN;
    if (!token || !env.MAIL_WORKER_NAME) {
      log.warn("watchdog_skipped", { reason: token ? "MAIL_WORKER_NAME unset" : "API token unset" });
      return;
    }
    try {
      const client = createCloudflareClient({ token, accountId: env.CF_ACCOUNT_ID || undefined });
      const report = await runWatchdog(env.DB, client, env.MAIL_WORKER_NAME);
      log.info("watchdog_run", {
        cron: controller.cron,
        checked: report.checked,
        drifted: report.drifted.length,
        restored: report.restored.length,
        failed: report.failed.length,
      });
    } catch (err) {
      log.error("watchdog_run_failed", { error: err instanceof Error ? err.message : "error" });
    }
  },
} satisfies ExportedHandler<Env, IngestJob>;

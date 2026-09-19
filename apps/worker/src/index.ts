import type { Env } from "./env";
import type { ExportedHandler, ExecutionContext, ForwardableEmailMessage, ScheduledController } from "@cloudflare/workers-types";
import { createCloudflareClient } from "./cf/api-client";
import { createApp } from "./app";
import { decorateResponse } from "./security/headers";
import { ingestEmail } from "./mail/ingest";
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
   * auto-created). A persistence throw propagates so Cloudflare retries delivery —
   * ingestion is dedupe-safe. Startup/deploy performs no domain mutation (section 9).
   */
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const result = await ingestEmail(message, env, env.DB, env.MAIL_BUCKET);
      if (result.status === "stored") {
        // Notify only after the mail is durable, and detached: a slow or dead push
        // endpoint must never affect delivery or make the message retry.
        ctx.waitUntil(pushToAll(env, env.DB).then(() => undefined));
      }
    } catch (err) {
      // Rejected for retry; log without body/token (section 34). The throw is deliberate.
      log.error("email_handler_failed", { error: err instanceof Error ? err.message : "error" });
      throw err;
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
} satisfies ExportedHandler<Env>;

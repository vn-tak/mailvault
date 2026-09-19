import type { ExportedHandler, ExecutionContext, ForwardableEmailMessage } from "@cloudflare/workers-types";
import type { Env } from "./env";
import { createApp } from "./app";
import { decorateResponse } from "./security/headers";
import { ingestEmail } from "./mail/ingest";
import { log } from "./lib/logging";

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
    void ctx;
    try {
      await ingestEmail(message, env, env.DB, env.MAIL_BUCKET);
    } catch (err) {
      // Rejected for retry; log without body/token (section 34). The throw is deliberate.
      log.error("email_handler_failed", { error: err instanceof Error ? err.message : "error" });
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;

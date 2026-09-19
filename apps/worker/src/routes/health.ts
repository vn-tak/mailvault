import { Hono } from "hono";
import { HealthSchema, MAILVAULT_VERSION } from "@mailvault/shared";
import type { AppEnv } from "../app-env";
import { nowIso } from "../lib/util";

/**
 * Unauthenticated liveness/readiness route (section 30). Reports only coarse health —
 * never config values, token contents, or identity. Mounted outside the auth gate so
 * Cloudflare/uptime probes can reach it; it exposes nothing sensitive.
 */
export const healthRoute = new Hono<AppEnv>().get("/api/health", async (c) => {
  const checks: { d1: "ok" | "error"; r2: "ok" | "error"; token: "ok" | "error" | "unset" } = {
    d1: "ok",
    r2: "ok",
    token: "ok",
  };
  try {
    await c.env.DB.prepare(`SELECT 1`).first();
  } catch {
    checks.d1 = "error";
  }
  try {
    // A zero-cost list to confirm the private bucket binding is live.
    await c.env.MAIL_BUCKET.list({ limit: 1 });
  } catch {
    checks.r2 = "error";
  }
  checks.token = c.env.CLOUDFLARE_API_TOKEN ? "ok" : "unset";

  const body = { ok: checks.d1 === "ok" && checks.r2 === "ok", version: MAILVAULT_VERSION, time: nowIso(), checks };
  return c.json(HealthSchema.parse(body), body.ok ? 200 : 503);
});

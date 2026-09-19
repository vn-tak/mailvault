/**
 * Runtime bindings + configuration for the MailVault Worker.
 * Boundings come from wrangler.jsonc; secrets are injected via `wrangler secret put`
 * (production) or `.dev.vars` (local). Nothing secret is ever read into a response.
 */
export interface Env {
  DB: D1Database;
  MAIL_BUCKET: R2Bucket;
  ASSETS: Fetcher;

  // Plain-text vars
  ENVIRONMENT?: string; // "development" | "production" (default production)
  CF_ACCOUNT_ID?: string;
  MAIL_WORKER_NAME?: string;
  APP_ORIGIN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  MAX_MESSAGE_BYTES?: string;
  ALLOWED_EMAILS?: string; // comma-separated owner allowlist (empty = any Access user)
  DEV_AUTH_BYPASS?: string;

  // Secrets
  CLOUDFLARE_API_TOKEN?: string;
}

export const DEFAULT_MAX_MESSAGE_BYTES = 20 * 1024 * 1024; // 20 MiB safety ceiling

export function maxMessageBytes(env: Env): number {
  const raw = Number.parseInt(env.MAX_MESSAGE_BYTES ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_MESSAGE_BYTES;
  // Cloudflare's incoming-message ceiling is ~25 MiB; never exceed it.
  return Math.min(raw, 25 * 1024 * 1024);
}

export function isDevelopment(env: Env): boolean {
  const e = (env.ENVIRONMENT ?? "").toLowerCase();
  return e === "development" || e === "local" || e === "test";
}

/**
 * Whether the Access check may be bypassed. True only when BOTH the explicit var is
 * set AND the environment is non-production — this makes an accidental production
 * bypass effectively impossible (section 28).
 */
export function devAuthBypassEnabled(env: Env): boolean {
  return (env.DEV_AUTH_BYPASS ?? "").toLowerCase() === "true" && isDevelopment(env);
}

export function allowedEmails(env: Env): string[] {
  return (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function appOrigin(env: Env): string {
  return (env.APP_ORIGIN ?? "").replace(/\/+$/, "");
}

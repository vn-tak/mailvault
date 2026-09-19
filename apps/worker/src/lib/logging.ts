/**
 * Structured operational logging (section 34). Emits JSON lines with safe fields only.
 * Never log: API tokens, Access JWTs, raw email bodies, OTPs, password-reset links,
 * attachment contents. Field names below are allow-listed by construction — callers
 * pass primitives, not whole objects.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const REDACTED_KEYS = new Set([
  "token",
  "authorization",
  "jwt",
  "cookie",
  "cf_authorization",
  "apikey",
  "api_key",
  "cloudflare_api_token",
  "raw",
  "body",
  "otp",
  "code",
]);

function sanitize(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[redacted]" : sanitize(v);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  return value;
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = { level, event, time: new Date().toISOString(), ...(sanitize(fields) as Record<string, unknown>) };
  const payload = JSON.stringify(line);
  // Workers has no levelled logger; console maps to Logpush observability.
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};

/** Never leak an arbitrary error's message if it might embed a URL/secret context. */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}

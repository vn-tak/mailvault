import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorCodes, type ErrorCode } from "@mailvault/shared";

/** Application error carrying an HTTP status + stable machine code (section 47). */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode | string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, ErrorCodes.Validation, msg, details);
export const unauthorized = (msg = "Authentication required") =>
  new AppError(401, ErrorCodes.Unauthorized, msg);
export const forbidden = (msg = "Not permitted") => new AppError(403, ErrorCodes.Forbidden, msg);
export const notFound = (msg = "Not found") => new AppError(404, ErrorCodes.NotFound, msg);
export const conflict = (msg: string, details?: unknown) =>
  new AppError(409, ErrorCodes.Conflict, msg, details);
export const rateLimited = (msg = "Too many requests") =>
  new AppError(429, ErrorCodes.RateLimited, msg);
export const badOrigin = (msg = "Cross-origin request rejected") =>
  new AppError(403, ErrorCodes.BadOrigin, msg);
export const upstream = (msg: string, details?: unknown) =>
  new AppError(502, ErrorCodes.UpstreamCloudflare, msg, details);

/**
 * Central Hono error handler. In production we never expose raw exception text or
 * stack traces; only AppError messages (which we author) are surfaced.
 */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  const isProd = (c.env?.ENVIRONMENT ?? "production").toLowerCase() !== "development";
  const message = isProd ? "Internal server error" : err.message || "Internal server error";
  if (!isProd) {
    // Surface the real error to local developers via console, not the response body.
    console.error("unhandled", err);
  }
  return c.json({ error: { code: ErrorCodes.Internal, message } }, 500);
}

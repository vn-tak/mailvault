import { z } from "zod";
import { MessageSummarySchema } from "./message";

/** Structured error envelope returned by every API failure (section 30/47). */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ErrorCodes = {
  Unauthorized: "UNAUTHORIZED",
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  Validation: "VALIDATION_ERROR",
  Conflict: "CONFLICT",
  RateLimited: "RATE_LIMITED",
  UpstreamCloudflare: "CLOUDFLARE_API_ERROR",
  Internal: "INTERNAL_ERROR",
  BadOrigin: "BAD_ORIGIN",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Cursor-free offset pagination — sufficient at personal scale. */
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  total: z.number().int().nonnegative(),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export function paginated<T>(items: T[], page: Pagination) {
  return { items, ...page };
}
export type Paginated<T> = { items: T[] } & Pagination;

export const MessageFilter = {
  All: "all",
  Unread: "unread",
} as const;

export const MessageListQuerySchema = z.object({
  filter: z.enum([MessageFilter.All, MessageFilter.Unread]).default(MessageFilter.All),
  domainId: z.string().min(1).optional(),
  aliasId: z.string().min(1).optional(),
  /** Full-text search over subject, preview and sender, plus an exact match on OTP codes. */
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

export const DashboardStatsSchema = z.object({
  activeDomains: z.number().int().nonnegative(),
  totalDomains: z.number().int().nonnegative(),
  totalAliases: z.number().int().nonnegative(),
  unreadMessages: z.number().int().nonnegative(),
  totalMessages: z.number().int().nonnegative(),
  recentMessages: z.array(MessageSummarySchema).default([]),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  time: z.string(),
  checks: z
    .object({
      d1: z.enum(["ok", "error"]),
      r2: z.enum(["ok", "error"]),
      token: z.enum(["ok", "error", "unset"]),
    })
    .partial(),
});
export type Health = z.infer<typeof HealthSchema>;

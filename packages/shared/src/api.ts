import { z } from "zod";
import { MessageSummarySchema } from "./message";
import { MailStatus } from "./enums";

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
  /**
   * Which side of a rule's filing to look at. `active` is the working list and the
   * default, so archiving something takes it out of the way without removing it.
   */
  archived: z.enum(["active", "archived", "all"]).default("active"),
  domainId: z.string().min(1).optional(),
  aliasId: z.string().min(1).optional(),
  /** Full-text search over subject, preview and sender, plus an exact match on OTP codes. */
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

/**
 * One domain as the owner sees it: a mailbox with its own mail in it. Counts come
 * straight from `messages`, so a mailbox can never claim mail it does not have.
 */
export const MailboxStatSchema = z.object({
  domainId: z.string(),
  name: z.string(),
  mailStatus: z.nativeEnum(MailStatus),
  total: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
  lastReceivedAt: z.string().nullable(),
});
export type MailboxStat = z.infer<typeof MailboxStatSchema>;

export const DashboardStatsSchema = z.object({
  activeDomains: z.number().int().nonnegative(),
  totalDomains: z.number().int().nonnegative(),
  totalAliases: z.number().int().nonnegative(),
  unreadMessages: z.number().int().nonnegative(),
  totalMessages: z.number().int().nonnegative(),
  recentMessages: z.array(MessageSummarySchema).default([]),
  mailboxes: z.array(MailboxStatSchema).default([]),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

/**
 * A registered passkey as the owner sees it. The credential id and public key are
 * verification material and are never returned.
 */
export const PasskeySchema = z.object({
  id: z.string(),
  deviceLabel: z.string().nullable(),
  transports: z.array(z.string()).nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type Passkey = z.infer<typeof PasskeySchema>;

/**
 * One sender domain that has written to more than one of the owner's aliases — i.e. the
 * address was reused, or resold, across services.
 */
export const AddressReuseSchema = z.object({
  senderDomain: z.string(),
  aliases: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
export type AddressReuse = z.infer<typeof AddressReuseSchema>;

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

/** Result of one push sweep. Deliberately carries no message content. */
export const PushOutcomeSchema = z.object({
  sent: z.number().int().nonnegative(),
  pruned: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.enum(["not-configured", "no-subscribers"]).optional(),
});
export type PushOutcome = z.infer<typeof PushOutcomeSchema>;

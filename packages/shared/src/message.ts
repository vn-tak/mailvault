import { z } from "zod";

/**
 * Message DTOs. `extractedCodes` / `verificationLinks` are stored in D1 as JSON
 * blobs; these schemas are the canonical shape for both persistence and the API.
 */

export const ExtractedCodeSchema = z.object({
  /** The code as it appeared (e.g. "593821" or "AB12-CD"). */
  value: z.string(),
  kind: z.enum(["numeric", "alphanumeric"]),
  length: z.number().int().positive(),
  /** 0..1 ranking used to pick the strongest candidate for the UI. */
  confidence: z.number().min(0).max(1),
  /** Short surrounding text that produced the match, for debugging/context. */
  context: z.string().max(200).optional(),
});
export type ExtractedCode = z.infer<typeof ExtractedCodeSchema>;

export const VerificationLinkSchema = z.object({
  url: z.string().url(),
  hostname: z.string(),
  /** Human label derived from nearby anchor text / context, e.g. "Verify account". */
  label: z.string().max(160).default(""),
  /** 0..1 ranking from contextual keywords. */
  score: z.number().min(0).max(1).default(0),
  context: z.string().max(200).optional(),
});
export type VerificationLink = z.infer<typeof VerificationLinkSchema>;

export const AttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  contentId: z.string().nullable().optional(),
  /** Authenticated, same-origin download path served by the Worker. */
  downloadPath: z.string(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/** Row shape for the inbox list (never carries full bodies — section 44). */
export const MessageSummarySchema = z.object({
  id: z.string(),
  aliasId: z.string(),
  aliasAddress: z.string(),
  aliasLabel: z.string().nullable(),
  domainName: z.string(),
  envelopeFrom: z.string(),
  headerFrom: z.string().nullable(),
  headerTo: z.string().nullable(),
  subject: z.string().nullable(),
  preview: z.string().nullable(),
  receivedAt: z.string(),
  isRead: z.boolean(),
  hasAttachments: z.boolean(),
  attachmentCount: z.number().int().nonnegative(),
  /** Best OTP candidate, precomputed for the list badge. */
  primaryCode: z.string().nullable().optional(),
  codeCount: z.number().int().nonnegative().default(0),
  linkCount: z.number().int().nonnegative().default(0),
});
export type MessageSummary = z.infer<typeof MessageSummarySchema>;

/** Full message payload for the detail view. */
export const MessageDetailSchema = MessageSummarySchema.extend({
  providerMessageId: z.string().nullable(),
  rawSize: z.number().int().nonnegative(),
  extractedCodes: z.array(ExtractedCodeSchema).default([]),
  verificationLinks: z.array(VerificationLinkSchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  /** Sanitized HTML ready for a sandboxed iframe (see SECURITY.md). */
  htmlBody: z.string().nullable(),
  /** Always-available plain-text fallback. */
  textBody: z.string().nullable(),
  /** Whether a parse failure occurred (raw .eml preserved regardless). */
  parseDegraded: z.boolean().default(false),
});
export type MessageDetail = z.infer<typeof MessageDetailSchema>;

export const ReadFlagSchema = z.object({ isRead: z.boolean() });
export type ReadFlag = z.infer<typeof ReadFlagSchema>;

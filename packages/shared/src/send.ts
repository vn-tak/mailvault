import { z } from "zod";

/**
 * Sending. The ceilings here are Cloudflare's, not ours, and they are quoted so a
 * rejected compose can say which one was hit instead of passing an upstream error
 * through untranslated.
 */
export const SEND_LIMITS = {
  /** Combined to + cc + bcc, as one message. */
  maxRecipients: 50,
  /** Subject is capped by Email Sending at 998 characters. */
  maxSubjectChars: 998,
  /** Whole message including body, measured in UTF-8 bytes. */
  maxTotalBytes: 5 * 1024 * 1024,
  /** Our own guard on how many addresses one person may compose at once. */
  maxDraftAddresses: 50,
} as const;

const AddressList = z.array(z.string().trim().min(3).max(254)).max(SEND_LIMITS.maxDraftAddresses);

/**
 * A compose. `fromAddress` must be one of the owner's own ACTIVE aliases — the API never
 * accepts an address it has not seen in `aliases`, because "send as anybody" is precisely
 * what an open relay is.
 */
export const ComposeInputSchema = z.object({
  fromAddress: z.string().trim().min(3).max(254),
  to: AddressList.min(1),
  cc: AddressList.optional(),
  bcc: AddressList.optional(),
  subject: z.string().max(SEND_LIMITS.maxSubjectChars).default(""),
  text: z.string().max(200_000).default(""),
  /** Optional. When present it is sanitised server-side the same way received HTML is. */
  html: z.string().max(400_000).optional(),
  fromName: z.string().max(120).optional(),
  /** Reply-To, when the owner wants answers somewhere other than the sending alias. */
  replyTo: z.string().trim().min(3).max(254).optional(),
  /** Mail id this compose answers. Sets In-Reply-To/References and joins its thread. */
  replyToMessageId: z.string().min(1).optional(),
});
export type ComposeInput = z.infer<typeof ComposeInputSchema>;

/**
 * A reply. Who it goes to and who it comes from are read from the message being answered,
 * never accepted from the client — otherwise the compose screen could aim a reply at an
 * address the owner never saw, or send as an alias that was never theirs.
 */
export const ReplyInputSchema = z.object({
  text: z.string().max(200_000).default(""),
  html: z.string().max(400_000).optional(),
  subject: z.string().max(SEND_LIMITS.maxSubjectChars).optional(),
  fromName: z.string().max(120).optional(),
  /** Extra recipients to bring in, beyond the one the message came from. */
  cc: AddressList.optional(),
});
export type ReplyInput = z.infer<typeof ReplyInputSchema>;

/** Autocomplete input: a fragment of an address or a display name, nothing more. */
export const RecipientQuerySchema = z.object({ q: z.string().trim().max(80).optional() });

/**
 * An address the owner has actually corresponded with, for the composer to suggest. Names and
 * addresses are their own mail — this is not a contact book, and nothing is collected from
 * anywhere else.
 */
export const RecipientSuggestionSchema = z.object({
  address: z.string(),
  name: z.string().nullable(),
  lastSeen: z.string(),
  /** True when this mailbox sent to that address, not just received from it. */
  outgoing: z.boolean().default(false),
});
export type RecipientSuggestion = z.infer<typeof RecipientSuggestionSchema>;

/** What the owner gets back: enough to render the row without a second fetch. */
export const SendOutcomeSchema = z.object({
  id: z.string(),
  status: z.string(),
  providerMessageId: z.string().nullable(),
  delivered: z.array(z.string()),
  queued: z.array(z.string()),
  bounced: z.array(z.string()),
  suppressed: z.array(z.string()),
  error: z.string().nullable(),
});
export type SendOutcome = z.infer<typeof SendOutcomeSchema>;

/** The sending capability of one domain, as the compose screen needs to see it. */
export const SendingCapabilitySchema = z.object({
  domainId: z.string(),
  domainName: z.string(),
  sendingStatus: z.string(),
  /** True when MailVault can send as an alias on this domain right now. */
  canSend: z.boolean(),
  /** Why it cannot, in a key the UI translates. */
  reason: z.string().nullable(),
});
export type SendingCapability = z.infer<typeof SendingCapabilitySchema>;

/** Dry-run of the DNS Email Sending will write for a domain, before anyone confirms it. */
export const SendingPreviewSchema = z.object({
  domainId: z.string(),
  domainName: z.string(),
  alreadyEnabled: z.boolean(),
  records: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        content: z.string(),
        priority: z.number().optional(),
      }),
    )
    .default([]),
  /** Codes like `dmarc.multiple` / `dkim.conflict` straight from Cloudflare's preview. */
  issues: z.array(z.object({ code: z.string(), existing: z.string().nullable() })).default([]),
  /** True when a DMARC record already exists and enabling sending would change it. */
  dmarcConflict: z.boolean().default(false),
  checkedAt: z.string(),
});
export type SendingPreview = z.infer<typeof SendingPreviewSchema>;

export const EnableSendingInputSchema = z.object({
  /** Explicit confirmation that the domain's DMARC record will be created or replaced. */
  allowDmarcTakeover: z.boolean().default(false),
});
export type EnableSendingInput = z.infer<typeof EnableSendingInputSchema>;

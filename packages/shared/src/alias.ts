import { z } from "zod";
import { AliasStatus, LocalPartMode } from "./enums";

/**
 * Alias rules. Local parts are intentionally conservative: only `a-z 0-9 . _ -`,
 * never leading/trailing separators, no consecutive dots, max 64 chars. This is a
 * deliberate subset of RFC 5321 — we do not support quoting or exotic syntax.
 */
export const LOCAL_PART_MAX_LENGTH = 64;
export const LABEL_MAX_LENGTH = 120;
/** System-reserved local parts that could collide with future control addresses. */
export const RESERVED_LOCAL_PARTS = [
  "postmaster",
  "abuse",
  "admin",
  "administrator",
  "root",
  "webmaster",
  "hostmaster",
  "mailer-daemon",
  "daemon",
  "noreply",
  "no-reply",
  "support",
  "security",
];

const LOCAL_PART_ALLOWED = /^[a-z0-9._-]+$/;

export function isValidLocalPart(localPart: string): boolean {
  if (localPart.length === 0 || localPart.length > LOCAL_PART_MAX_LENGTH) return false;
  if (!LOCAL_PART_ALLOWED.test(localPart)) return false;
  if (localPart.startsWith(".") || localPart.endsWith(".")) return false;
  if (localPart.startsWith("-") || localPart.endsWith("-")) return false;
  if (localPart.startsWith("_") || localPart.endsWith("_")) return false;
  if (localPart.includes("..")) return false;
  if (RESERVED_LOCAL_PARTS.includes(localPart)) return false;
  return true;
}

/** Lowercase + trim a user-supplied local part before validation. */
export function normalizeLocalPartInput(input: string): string {
  return input.trim().toLowerCase();
}

/** Turn an arbitrary service name (e.g. "GitHub HQ!") into a safe prefix ("github-hq"). */
export function sanitizeServicePrefix(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .replace(/[-._]{2,}/g, "-")
    .slice(0, 30);
}

export const AliasSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  domainName: z.string().optional(),
  localPart: z.string(),
  address: z.string(),
  label: z.string().nullable(),
  status: z.nativeEnum(AliasStatus),
  messageCount: z.number().int().nonnegative().optional(),
  unreadCount: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Alias = z.infer<typeof AliasSchema>;

const customLocalPart = z
  .string()
  .min(1)
  .max(LOCAL_PART_MAX_LENGTH)
  .refine((v) => isValidLocalPart(v), { message: "Invalid local part" });

const servicePrefix = z
  .string()
  .min(1)
  .max(30)
  .transform((v) => sanitizeServicePrefix(v))
  .refine((v) => v.length > 0 && isValidLocalPart(`${v}-x`), {
    message: "Service label produces an invalid prefix",
  });

export const CreateAliasSchema = z.discriminatedUnion("mode", [
  z.object({
    domainId: z.string().min(1),
    mode: z.literal(LocalPartMode.Random),
    label: z.string().max(LABEL_MAX_LENGTH).nullish(),
  }),
  z.object({
    domainId: z.string().min(1),
    mode: z.literal(LocalPartMode.ServiceRandom),
    service: servicePrefix,
    label: z.string().max(LABEL_MAX_LENGTH).nullish(),
  }),
  z.object({
    domainId: z.string().min(1),
    mode: z.literal(LocalPartMode.Custom),
    localPart: customLocalPart,
    label: z.string().max(LABEL_MAX_LENGTH).nullish(),
  }),
]);
export type CreateAliasInput = z.input<typeof CreateAliasSchema>;
export type CreateAliasParsed = z.output<typeof CreateAliasSchema>;

/** PATCH /api/aliases/:id — currently only the label can be edited inline. */
export const UpdateAliasSchema = z.object({
  label: z.string().max(LABEL_MAX_LENGTH).nullable(),
});
export type UpdateAliasInput = z.infer<typeof UpdateAliasSchema>;

/** DELETE /api/aliases/:id — `purgeMessages` also removes its stored mail. */
export const DeleteAliasSchema = z.object({
  purgeMessages: z.boolean().default(false),
});
export type DeleteAliasInput = z.infer<typeof DeleteAliasSchema>;

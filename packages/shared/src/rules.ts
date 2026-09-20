import { z } from "zod";

/**
 * Mailbox rules: owner-written sorting instructions evaluated when a message is committed.
 *
 * Two limits are deliberate. A rule may only *organise* — archive, pin, tag — never
 * delete, because an automated rule that destroys mail is the one failure mode this
 * project promises not to have (SECURITY.md §10). And a rule never creates an alias:
 * acceptance of mail is decided by the alias table alone.
 */

export const RuleMatchSchema = z
  .object({
    /** Exact sender domain after the @, compared case-insensitively. */
    senderDomain: z.string().min(1).max(253).optional(),
    subjectContains: z.string().min(1).max(120).optional(),
    aliasId: z.string().min(1).optional(),
    domainId: z.string().min(1).optional(),
    hasCode: z.boolean().optional(),
    hasAttachment: z.boolean().optional(),
  })
  .refine((m) => Object.keys(m).length > 0, { message: "A rule needs at least one condition" });

export const RuleActionSchema = z
  .object({
    /** Out of the working list, never deleted. */
    archive: z.boolean().optional(),
    tag: z.string().min(1).max(60).optional(),
  })
  .refine((a) => Object.keys(a).length > 0, { message: "A rule has to do something" });

export const CreateRuleSchema = z.object({
  match: RuleMatchSchema,
  action: RuleActionSchema,
  enabled: z.boolean().default(true),
});
export type RuleMatch = z.infer<typeof RuleMatchSchema>;
export type RuleAction = z.infer<typeof RuleActionSchema>;
export type CreateRuleInput = z.input<typeof CreateRuleSchema>;

export const UpdateRuleSchema = z.object({
  match: RuleMatchSchema.optional(),
  action: RuleActionSchema.optional(),
  enabled: z.boolean().optional(),
});

export const RuleSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  match: RuleMatchSchema,
  action: RuleActionSchema,
  hits: z.number().int().nonnegative(),
  lastHitAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Rule = z.infer<typeof RuleSchema>;

/** How a rule was described at the moment it acted — kept on the message so an old
 *  archive can still be explained after the rule itself is edited or removed. */
export function describeRule(match: z.infer<typeof RuleMatchSchema>, action: z.infer<typeof RuleActionSchema>): string {
  const when = [
    match.senderDomain ? `from ${match.senderDomain}` : null,
    match.subjectContains ? `subject contains “${match.subjectContains}”` : null,
    match.domainId ? "in this domain" : null,
    match.aliasId ? "on this alias" : null,
    match.hasCode === true ? "with a code" : null,
    match.hasCode === false ? "without a code" : null,
    match.hasAttachment === true ? "with an attachment" : null,
    match.hasAttachment === false ? "without an attachment" : null,
  ].filter(Boolean);
  const do_ = [action.archive ? "archived" : null, action.tag ? `tagged “${action.tag}”` : null].filter(Boolean);
  return `${do_.join(" + ")} by rule: ${when.join(", ") || "everything"}`;
}

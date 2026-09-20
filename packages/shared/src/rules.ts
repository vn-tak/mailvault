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

/** The wording of a rule summary. English by default; the app passes its own language. */
export interface RulePhrases {
  from: (domain: string) => string;
  subjectContains: (text: string) => string;
  inDomain: string;
  onAlias: string;
  withCode: string;
  withoutCode: string;
  withAttachment: string;
  withoutAttachment: string;
  archived: string;
  tagged: (tag: string) => string;
  join: string;
  byRule: string;
  everything: string;
}

export const EN_RULE: RulePhrases = {
  from: (domain) => `from ${domain}`,
  subjectContains: (text) => `subject contains “${text}”`,
  inDomain: "in this domain",
  onAlias: "on this alias",
  withCode: "with a code",
  withoutCode: "without a code",
  withAttachment: "with an attachment",
  withoutAttachment: "without an attachment",
  archived: "archived",
  tagged: (tag) => `tagged “${tag}”`,
  join: " + ",
  byRule: " by rule: ",
  everything: "everything",
};

/** How a rule was described at the moment it acted — kept on the message so an old
 *  archive can still be explained after the rule itself is edited or removed. */
export function describeRule(
  match: z.infer<typeof RuleMatchSchema>,
  action: z.infer<typeof RuleActionSchema>,
  phrases: RulePhrases = EN_RULE,
): string {
  const when = [
    match.senderDomain ? phrases.from(match.senderDomain) : null,
    match.subjectContains ? phrases.subjectContains(match.subjectContains) : null,
    match.domainId ? phrases.inDomain : null,
    match.aliasId ? phrases.onAlias : null,
    match.hasCode === true ? phrases.withCode : null,
    match.hasCode === false ? phrases.withoutCode : null,
    match.hasAttachment === true ? phrases.withAttachment : null,
    match.hasAttachment === false ? phrases.withoutAttachment : null,
  ].filter(Boolean);
  const do_ = [action.archive ? phrases.archived : null, action.tag ? phrases.tagged(action.tag) : null].filter(Boolean);
  return `${do_.join(phrases.join)}${phrases.byRule}${when.join(", ") || phrases.everything}`;
}

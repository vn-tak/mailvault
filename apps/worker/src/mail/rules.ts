import { describeRule, type Rule, type RuleMatch } from "@mailvault/shared";
import { log } from "../lib/logging";

/** What is known about a message at the moment rules run. */
export interface RuleFacts {
  senderDomain: string;
  subject: string | null;
  aliasId: string;
  domainId: string;
  hasCode: boolean;
  hasAttachment: boolean;
}

/**
 * Every condition present must hold; conditions that were not set are not satisfied by
 * accident. An empty match would archive everything, which is why the schema refuses it
 * and this function mirrors that.
 */
export function matches(match: RuleMatch, f: RuleFacts): boolean {
  if (match.senderDomain && match.senderDomain.toLowerCase() !== f.senderDomain) return false;
  if (match.subjectContains && !(f.subject ?? "").toLowerCase().includes(match.subjectContains.toLowerCase())) return false;
  if (match.aliasId && match.aliasId !== f.aliasId) return false;
  if (match.domainId && match.domainId !== f.domainId) return false;
  if (match.hasCode !== undefined && match.hasCode !== f.hasCode) return false;
  if (match.hasAttachment !== undefined && match.hasAttachment !== f.hasAttachment) return false;
  return true;
}

export interface RulePlan {
  archive: boolean;
  tag: string | null;
  matched: Rule[];
}

/** Rules apply in creation order and their effects accumulate. */
export function planRules(rules: Rule[], f: RuleFacts): RulePlan {
  const plan: RulePlan = { archive: false, tag: null, matched: [] };
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!matches(rule.match, f)) continue;
    plan.archive = plan.archive || !!rule.action.archive;
    if (rule.action.tag) plan.tag = rule.action.tag;
    plan.matched.push(rule);
  }
  return plan;
}

export interface AppliedRules {
  ruleId: string | null;
  ruleIds: string[];
  note: string | null;
  archive: boolean;
  tag: string | null;
}

export const NO_RULES: AppliedRules = { ruleId: null, ruleIds: [], note: null, archive: false, tag: null };

/**
 * Decide what rules do to one message. The note records the rule's wording at this moment
 * and is stored on the message, so an archive made months ago is still explainable after
 * the rule has been edited or deleted.
 */
export function applyRules(rules: Rule[], f: RuleFacts): AppliedRules {
  const plan = planRules(rules, f);
  if (plan.matched.length === 0) return NO_RULES;
  const first = plan.matched[0]!;
  const note = plan.matched.map((r) => describeRule(r.match, r.action)).join("; ");
  log.info("rules_applied", { rules: plan.matched.map((r) => r.id), archive: plan.archive });
  return {
    ruleId: first.id,
    ruleIds: plan.matched.map((r) => r.id),
    note,
    archive: plan.archive,
    tag: first.action.tag ?? null,
  };
}

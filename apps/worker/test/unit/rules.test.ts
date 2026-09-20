import { describe, expect, it } from "vitest";
import { applyRules, matches, NO_RULES, planRules, type RuleFacts } from "../../src/mail/rules";
import type { Rule } from "@mailvault/shared";

const facts: RuleFacts = {
  senderDomain: "newsletters.github.com",
  subject: "Your weekly digest is ready",
  aliasId: "alias-1",
  domainId: "domain-1",
  hasCode: false,
  hasAttachment: false,
};

function rule(id: string, match: Rule["match"], action: Rule["action"], enabled = true): Rule {
  return { id, enabled, match, action, hits: 0, lastHitAt: null, createdAt: "2026-09-20T00:00:00.000Z" };
}

describe("matches", () => {
  it("requires every condition it was given", () => {
    expect(matches({ senderDomain: "newsletters.github.com", subjectContains: "digest" }, facts)).toBe(true);
    expect(matches({ senderDomain: "newsletters.github.com", subjectContains: "invoice" }, facts)).toBe(false);
  });

  it("compares the domain case-insensitively and the subject as a substring", () => {
    expect(matches({ senderDomain: "NewsLetters.GitHub.COM" }, facts)).toBe(true);
    expect(matches({ subjectContains: "WEEKLY" }, facts)).toBe(true);
  });

  it("does not match a different sender that merely shares a prefix", () => {
    expect(matches({ senderDomain: "github.com" }, facts)).toBe(false);
  });

  it("treats a false flag as a condition, not as silence", () => {
    expect(matches({ hasCode: false }, facts)).toBe(true);
    expect(matches({ hasCode: true }, facts)).toBe(false);
  });
});

describe("planRules", () => {
  it("ignores paused rules", () => {
    expect(planRules([rule("r1", { senderDomain: "newsletters.github.com" }, { archive: true }, false)], facts).matched).toEqual([]);
  });

  it("accumulates the effects of every rule that matched, oldest first", () => {
    const plan = planRules(
      [
        rule("r1", { senderDomain: "newsletters.github.com" }, { tag: "newsletters" }),
        rule("r2", { subjectContains: "digest" }, { archive: true }),
        rule("r3", { senderDomain: "other.example" }, { archive: true }),
      ],
      facts,
    );
    expect(plan.matched.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(plan.archive).toBe(true);
    expect(plan.tag).toBe("newsletters");
  });
});

describe("applyRules", () => {
  it("does nothing at all when no rule matched", () => {
    expect(applyRules([rule("r1", { senderDomain: "nope.example" }, { archive: true })], facts)).toEqual(NO_RULES);
  });

  it("keeps the wording of the rule that acted, so an old archive still explains itself", () => {
    const applied = applyRules([rule("r1", { senderDomain: "newsletters.github.com" }, { archive: true, tag: "newsletters" })], facts);
    expect(applied.ruleId).toBe("r1");
    expect(applied.archive).toBe(true);
    expect(applied.note).toContain("archived");
    expect(applied.note).toContain("tagged “newsletters”");
    expect(applied.note).toContain("newsletters.github.com");
  });
});

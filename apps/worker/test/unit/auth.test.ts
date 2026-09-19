import { describe, expect, it } from "vitest";
import { AuthVerdict } from "@mailvault/shared";
import { AuthOutcome, assessAuth, bareDomain, domainsAlign, registrableDomain } from "../../src/mail/auth";

const NETFLIX_AR = "mx.netflix.com; spf=pass (domain: netflix.com) smtp.mailfrom=returns.netflix.com; dkim=pass header.d=netflix.com; dmarc=pass (p=none dis=none) header.from=netflix.com";

function assess(authResults: string[], headerFrom: string, envelopeFrom: string) {
  return assessAuth({ authResults, headerFrom, envelopeFrom });
}

describe("aligned passes only (section: hostile input)", () => {
  it("trusts a DMARC pass aligned with the From domain", () => {
    const a = assess([NETFLIX_AR], "Netflix <no-reply@netflix.com>", "bounce@returns.netflix.com");
    expect(a.verdict).toBe(AuthVerdict.Trusted);
    expect(a.dmarc).toBe(AuthOutcome.Pass);
    expect(a.dkim).toBe(AuthOutcome.Pass);
    expect(a.envelopeMismatch).toBe(false);
  });

  it("does NOT trust a self-authored Authentication-Results header", () => {
    // The attacker controls the message, so "pass" only counts when the vouched-for
    // domain aligns with From. Here it does not.
    const a = assess(
      ["evil.example; spf=pass smtp.mailfrom=evil.example; dkim=pass header.d=evil.example"],
      "Netflix <security@genuine-netflix-verify.com>",
      "spam@evil.example",
    );
    expect(a.verdict).not.toBe(AuthVerdict.Trusted);
    expect(a.dkim).toBe(AuthOutcome.Pass); // reported as observed...
    expect(a.alignedPass.dkim).toBe(false); // ...but it vouches for evil.example, not for From
  });

  it("treats dmarc=fail as spoofing even when a DKIM pass is present but misaligned", () => {
    const a = assess(
      ["mailer.x; dkim=pass header.d=other.org; dmarc=fail (p=reject dis=none) header.from=netflix.com"],
      "Netflix <security@netflix.com>",
      "bounce@mailer.x",
    );
    expect(a.verdict).toBe(AuthVerdict.Spoofed);
    expect(a.dmarc).toBe(AuthOutcome.Fail);
  });

  it("keeps a forwarded message trusted: aligned dkim pass despite a third-party spf fail", () => {
    const a = assess(
      [
        "forwarder.example; spf=fail smtp.mailfrom=netflix.com",
        "mx.googleapis.com; dkim=pass header.d=netflix.com; dmarc=pass header.from=netflix.com",
      ],
      "Netflix <no-reply@netflix.com>",
      "me@forwarder.example",
    );
    expect(a.verdict).toBe(AuthVerdict.Trusted);
    expect(a.spf).toBe(AuthOutcome.Fail); // reported honestly, but not the trust signal
    expect(a.envelopeMismatch).toBe(true);
  });

  it("reports unverified, never spoofed, when Cloudflare gave us no results at all", () => {
    const a = assess([], "someone@example.com", "someone@example.com");
    expect(a.verdict).toBe(AuthVerdict.Unverified);
    expect(a.observed).toBe(false);
  });

  it("survives malformed header values", () => {
    const a = assess([";;; totally not rfc 8601 ;;;", "mx; spf=weird smtp.mailfrom="], "x@example.com", "y@example.com");
    expect(a.evidence.length).toBeLessThanOrEqual(1);
    expect(a.verdict).toBe(AuthVerdict.Unverified);
  });
});

describe("domain comparison", () => {
  it("aligns subdomains and rejects look-alikes", () => {
    expect(domainsAlign("mail.netflix.com", "netflix.com")).toBe(true);
    expect(domainsAlign("netflix.com", "netflix.com")).toBe(true);
    expect(domainsAlign("notnetflix.com", "netflix.com")).toBe(false);
    expect(domainsAlign("netflix.com.evil.org", "netflix.com")).toBe(false); // look-alike trap
    expect(domainsAlign("evil.netflix.com", "netflix.co")).toBe(false);
  });

  it("keeps multi-part public suffixes intact", () => {
    expect(registrableDomain("mail.antexvn.com.vn")).toBe("antexvn.com.vn");
    expect(registrableDomain("www.abitovn.com")).toBe("abitovn.com");
    expect(registrableDomain("localhost")).toBe("localhost");
  });

  it("reads a domain out of display names and angle brackets", () => {
    expect(bareDomain('"Netflix" <no-reply@netflix.com>')).toBe("no-reply@netflix.com".split("@")[1]);
    expect(bareDomain("  ")).toBeNull();
    expect(bareDomain(null)).toBeNull();
  });
});

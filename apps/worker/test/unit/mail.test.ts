import { describe, expect, it } from "vitest";
import { extractOtp } from "../../src/mail/otp";
import { extractLinks } from "../../src/mail/links";
import { normalizeDomain, normalizeLookupAddress, splitAddress } from "../../src/mail/normalize";
import { buildPreview, stripHtmlToText } from "../../src/mail/preview";
import { sanitizeFilename } from "../../src/lib/filename";
import { assessMx, detectProvider, isCloudflareRoutingMx } from "../../src/provisioning/mx";
import { sanitizeEmailHtml } from "../../src/security/sanitize-html";

describe("recipient normalization", () => {
  it("lowercases domain and local part deterministically", () => {
    expect(normalizeLookupAddress("GitHub-AbC@Example.com")).toBe("github-abc@example.com");
    expect(normalizeDomain("ExAmPlE.COM")).toBe("example.com");
  });
  it("splits at the last @ and flags malformed addresses", () => {
    expect(splitAddress("a@b@example.com").local).toBe("a@b");
    expect(splitAddress("a@b@example.com").domain).toBe("example.com");
    expect(splitAddress("no-at-sign").valid).toBe(false);
    expect(splitAddress("@example.com").valid).toBe(false);
  });
});

describe("OTP extraction", () => {
  it("surfaces a contextual 6-digit code with high confidence", () => {
    const codes = extractOtp("Your verification code is 593821. It expires in 10 minutes.");
    const match = codes.find((c) => c.value === "593821");
    expect(match).toBeTruthy();
    expect(match!.kind).toBe("numeric");
    expect(match!.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("does not treat dates, prices or phone numbers as codes", () => {
    const noise = extractOtp("Invoice #2026 dated 2026-09-19 for $1,299.00. Call 555-123-4567 for support.");
    for (const bad of ["2026", "0919", "1299", "1234", "4567"]) {
      expect(noise.some((c) => c.value === bad && c.confidence >= 0.5)).toBe(false);
    }
  });
});

describe("verification link extraction", () => {
  it("ranks verification links above tracking links and exposes hostname", () => {
    const links = extractLinks(
      "Confirm your account at https://accounts.example.com/verify?token=abc",
      '<a href="https://news.example.com/newsletter">Newsletter</a><a href="https://app.example.com/reset-password">Reset</a>',
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.hostname).toBeTruthy();
    expect(links.some((l) => /verify|reset/.test(l.url))).toBe(true);
    // Scored descending.
    for (let i = 1; i < links.length; i++) {
      expect(links[i - 1]!.score).toBeGreaterThanOrEqual(links[i]!.score);
    }
  });

  it("returns no links for body without URLs", () => {
    expect(extractLinks("no urls here").length).toBe(0);
  });
});

describe("preview + html->text", () => {
  it("strips tags and collapses whitespace", () => {
    expect(stripHtmlToText("<p>Hello   <b>world</b></p>")).toContain("Hello");
    expect(buildPreview(null, "<div>Some long text here</div>")).toContain("Some long text");
  });
});

describe("attachment filename safety", () => {
  it("removes traversal and control characters, keeps a basename", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFilename('invoice".exe')).not.toContain('"');
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
  });
});

describe("MX assessment (section 7)", () => {
  it("flags foreign provider MX and marks not clear for us", () => {
    const a = assessMx([{ content: "aspmx.l.google.com", priority: 1 }]);
    expect(a.foreign.length).toBe(1);
    expect(a.foreign[0]!.provider).toBe("Google Workspace");
    expect(a.clearForUs).toBe(false);
    expect(detectProvider("aspmx.l.google.com")).toBeTruthy();
  });
  it("recognizes Cloudflare routing MX as ours", () => {
    expect(isCloudflareRoutingMx("route1.mx.cloudflare.net")).toBe(true);
    const a = assessMx([{ content: "route2.mx.cloudflare.net", priority: 20 }]);
    expect(a.cloudflareRouting).toBe(1);
    expect(a.clearForUs).toBe(true);
  });
  it("treats an empty MX set as clear to provision", () => {
    const a = assessMx([]);
    expect(a.clearForUs).toBe(true);
    expect(a.total).toBe(0);
  });
});

describe("email HTML sanitization (section 19)", () => {
  it("drops scripts, event handlers and javascript: URLs", () => {
    const out = sanitizeEmailHtml(
      `<p>Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="x" onerror="evil()">`,
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("onerror");
    expect(out).toContain("Hello");
  });
  it("blocks remote images by default, allows when opted in", () => {
    const blocked = sanitizeEmailHtml('<img src="https://track.example/o.gif">');
    expect(blocked).not.toContain("track.example");
    const allowed = sanitizeEmailHtml('<img src="https://track.example/o.gif">', { allowRemoteImages: true });
    expect(allowed).toContain("track.example");
  });
  it("forces safe external links", () => {
    const out = sanitizeEmailHtml('<a href="https://example.com/verify">go</a>');
    expect(out).toContain('rel="');
    expect(out).toContain("noopener");
  });
});

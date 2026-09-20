import { describe, expect, it } from "vitest";
import { extractLinks, unfoldUrl, unwrapDestination } from "../../src/mail/links";

/*
 * These cover the three ways a verification link stops being usable: the mailer folded it
 * across a line break, a click-tracking wrapper hides the real host, or sentence
 * punctuation got swallowed into the token. A silently wrong destination is worse than a
 * visibly truncated one, so the unfolding rules are as much about what must NOT join.
 */

describe("folded plaintext URLs", () => {
  it("rejoins a magic link the mailer broke after a query separator", () => {
    const text = "Confirm your address:\nhttps://accounts.example.com/confirm?t=\n9f8e7d6c5b4a3210\n";
    const [link] = extractLinks(text);
    expect(link?.url).toBe("https://accounts.example.com/confirm?t=9f8e7d6c5b4a3210");
  });

  it("keeps joining across several folded lines until the token ends", () => {
    const text = "verify at https://x.example.com/a?token=abc%2Fdef\n%26ghi&next=%2Fhome\n";
    const [link] = extractLinks(text);
    expect(link?.url).toBe("https://x.example.com/a?token=abc%2Fdef%26ghi&next=%2Fhome");
  });

  it("does not glue the next prose line onto a complete URL", () => {
    const text = "Visit https://account.example.com/verify now\nThanks for choosing Example Inc\n";
    const [link] = extractLinks(text);
    expect(link?.url).toBe("https://account.example.com/verify");
  });

  it("stops at a quote or angle bracket that wrapped the address", () => {
    const text = 'Use <https://login.example.com/magic?code=11223344> within 10 minutes.';
    const [link] = extractLinks(text);
    expect(link?.url).toBe("https://login.example.com/magic?code=11223344");
  });

  it("unfoldUrl returns the fragment unchanged when the line simply ends", () => {
    expect(unfoldUrl("https://a.example.com/x\n", 0)).toBe("https://a.example.com/x");
  });
});

describe("click-through wrappers", () => {
  const wrapper =
    "https://59.email.stripe.com/CL0/https:%2F%2Fsupport.link.com%2Fconfirm-email%2Fconfirm%3Ft=csmrect_abc123%26ref=signup/1/010101a0ba5a30a0-8dc5e2f4";

  it("recovers the destination behind a SendGrid-style /CL0/ wrapper", () => {
    expect(unwrapDestination(wrapper)).toBe("https://support.link.com/confirm-email/confirm?t=csmrect_abc123&ref=signup");
  });

  it("shows the destination as the host the owner is trusting, and keeps the sent URL", () => {
    const text = `Please confirm your address by verifying: ${wrapper}`;
    const [link] = extractLinks(text);
    expect(link?.hostname).toBe("59.email.stripe.com");
    expect(link?.destination).toBe("https://support.link.com/confirm-email/confirm?t=csmrect_abc123&ref=signup");
    expect(link?.url).toBe(wrapper);
  });

  it("lists a wrapped link and its direct twin once", () => {
    const direct = "https://support.link.com/confirm-email/confirm?t=csmrect_abc123&ref=signup";
    const links = extractLinks(`Verify: ${direct}\nOr ${wrapper}`);
    expect(links).toHaveLength(1);
    expect(links[0]?.destination).toBe(direct);
  });

  it("unwraps a destination query parameter", () => {
    expect(unwrapDestination("https://click.mailer.example/open?u=https%3A%2F%2Fapp.example.com%2Fverify%3Ftoken%3D7788")).toBe(
      "https://app.example.com/verify?token=7788",
    );
  });

  it("leaves alone links that are not wrappers, and values that are not URLs", () => {
    expect(unwrapDestination("https://account.example.com/verify?t=1&redirect=app")).toBeNull();
    expect(unwrapDestination("https://account.example.com/verify?target=dashboard")).toBeNull();
    expect(unwrapDestination("https://59.email.stripe.com/CL0/not-a-url/1/abc")).toBeNull();
  });
});

describe("href cleanup", () => {
  it("decodes entities inside an anchor href so the token survives", () => {
    const links = extractLinks(
      "",
      '<a href="https://accounts.example.com/reset?token=abc&amp;expiry=600">Reset password</a>',
    );
    expect(links[0]?.url).toBe("https://accounts.example.com/reset?token=abc&expiry=600");
    expect(links[0]?.label).toBe("Reset password");
  });

  it("drops sentence punctuation but keeps a balanced parenthetical path", () => {
    const links = extractLinks("Confirm (https://x.example.com/compare(a,b)) now, see https://y.example.com/v?token=1.");
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://x.example.com/compare(a,b)");
    expect(urls).toContain("https://y.example.com/v?token=1");
  });

  it("ignores non-http schemes and keeps only verification-shaped links", () => {
    expect(extractLinks('Contact us: mailto:hi@example.com or <a href="javascript:alert(1)">x</a>').length).toBe(0);
  });
});

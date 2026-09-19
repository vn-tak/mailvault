import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMime } from "../../src/mail/parse";
import { extractOtp } from "../../src/mail/otp";
import { extractLinks } from "../../src/mail/links";
import { stripHtmlToText } from "../../src/mail/preview";
import { sanitizeEmailHtml } from "../../src/security/sanitize-html";

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))));
}

describe("email fixtures parse end-to-end", () => {
  it("plain-text OTP mail: headers, body and code extraction", async () => {
    const parsed = await parseMime(load("otp-plaintext.eml"));
    expect(parsed.subject).toBe("Your Acme verification code");
    expect(parsed.messageId).toBe("otp-1@acme.example");
    expect(parsed.headerFrom).toContain("no-reply@acme.example");
    expect(parsed.text).toContain("429117");
    expect(parsed.attachments).toHaveLength(0);

    const codes = extractOtp(parsed.text ?? "");
    expect(codes.some((c) => c.value === "429117" && c.kind === "numeric")).toBe(true);
  });

  it("multipart HTML mail: attachment + verification link + safe sanitization", async () => {
    const parsed = await parseMime(load("verify-html-attachment.eml"));
    expect(parsed.text).toBeTruthy();
    expect(parsed.html).toContain("Confirm your sign-in");

    const pdf = parsed.attachments.find((a) => a.filename === "invoice.pdf");
    expect(pdf).toBeTruthy();
    expect(pdf?.contentType).toBe("application/pdf");
    expect((pdf?.size ?? 0)).toBeGreaterThan(0);

    const links = extractLinks(parsed.text ?? "", parsed.html);
    expect(links.some((l) => l.hostname === "secureapp.example" && l.url.includes("/confirm"))).toBe(true);

    const safe = sanitizeEmailHtml(parsed.html ?? "");
    // The <script> element is stripped; its former contents survive only as
    // inert escaped text (no live tag, no javascript:, no remote loading).
    expect(safe.toLowerCase()).not.toContain("<script");
    expect(safe.toLowerCase()).not.toContain("javascript:");
    // Remote tracking pixel is blocked by default.
    expect(safe.toLowerCase()).not.toContain("track.secureapp.example");
    // The verification anchor survives, hardened with rel=noopener.
    expect(safe).toContain("secureapp.example/confirm");
    expect(safe).toMatch(/rel="[^"]*noopener/);
  });

  it("HTML-only reset mail: text fallback extraction ignores noise numbers", async () => {
    const parsed = await parseMime(load("reset-otp-html.eml"));
    expect(parsed.text).toBeNull();
    const text = stripHtmlToText(parsed.html ?? "");
    expect(text).toContain("778812");

    const values = extractOtp(text).map((c) => c.value);
    expect(values).toContain("778812");
    // Long order id and phone fragment must not be mistaken for OTPs.
    expect(values).not.toContain("1002345678");
    expect(values).not.toContain("4155550134");
  });
});

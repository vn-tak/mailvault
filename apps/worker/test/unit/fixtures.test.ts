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

/*
 * One fixture that packs the ways a real provider breaks a reading view: a JWT token cut in
 * half by a hard line break, a click-tracking wrapper standing in front of the address, an
 * indented summary table, and an HTML part with an unbreakable 150-char URL.
 */
describe("body stress fixture", () => {
  it("recovers a magic link the mailer folded across a line break", async () => {
    const parsed = await parseMime(load("body-stress.eml"));
    const foldedLine = (parsed.text ?? "").split(/\r?\n/).find((l) => l.includes("eyJhbGci")) ?? "";
    expect(foldedLine.endsWith("OiJVNT")).toBe(true); // the token really is split

    const links = extractLinks(parsed.text ?? "", parsed.html);
    const magic = links.find((l) => l.url.includes("token=eyJ"));
    expect(magic?.url).toBe(
      "https://console.cloud.example/verify?intent=device&token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9" +
        ".eyJzdWIiOiJVNThTTEoiLCJleHAiOjE3OTAwMDAwMDAwfQ&sig=MEUCIQDT%2B7kc0V3nKqZ8&next=%2Fsettings%2Fsecurity",
    );
    expect(magic?.url).not.toContain("\n");
  });

  it("names the destination behind a click-through wrapper, and lists that link once", async () => {
    const parsed = await parseMime(load("body-stress.eml"));
    const links = extractLinks(parsed.text ?? "", parsed.html);
    const target = "https://console.cloud.example/verify?intent=device&token=short&sig=MEUCIQDT";

    const wrapped = links.find((l) => l.hostname === "59.email.cloud.example");
    expect(wrapped?.destination).toBe(target);
    // Collapsing the wrapper with the honest anchor keeps the anchor's readable label.
    expect(wrapped?.label).toBe("Confirm your device");
    expect(links.filter((l) => (l.destination ?? l.url) === target)).toHaveLength(1);
  });

  it("keeps the OTP, the indented block and the sanitization guarantees", async () => {
    const parsed = await parseMime(load("body-stress.eml"));
    expect(extractOtp(`${parsed.subject ?? ""}\n${parsed.text ?? ""}`).map((c) => c.value)).toContain("441702");
    expect(parsed.text).toContain("  device     Chrome 129 on macOS 15.6");
    expect(parsed.text).toContain("  location   Hanoi, VN");

    const safe = sanitizeEmailHtml(parsed.html ?? "");
    expect(safe.toLowerCase()).not.toContain("<script");
    // The stripped script's source survives as inert escaped text (like the other
    // fixtures), so assert what matters: nothing loads or links to it.
    expect(safe).not.toMatch(/(href|src)="[^"]*evil\.example/);
    expect(safe).not.toContain("track.cloud.example"); // remote pixel blocked by default
    expect(safe).toContain("docs.cloud.example/handbook"); // the long reference link survives
    expect(safe).toContain("intent=device&amp;token=short"); // entity kept as one entity, not doubled
  });

  it("keeps the E2E body artifact in step with the .eml it came from", async () => {
    const parsed = await parseMime(load("body-stress.eml"));
    const committed = JSON.parse(
      readFileSync(fileURLToPath(new URL("../fixtures/parsed-body-stress.json", import.meta.url)), "utf8"),
    ) as { text: string; html: string };
    expect(committed.text).toBe(parsed.text);
    expect(committed.html).toBe(parsed.html);
  });
});

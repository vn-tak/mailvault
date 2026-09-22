import { describe, expect, it } from "vitest";
import { buildOutboundMime } from "../../src/mail/mime";
import { addressesOf } from "../../src/mail/normalize";

const base = {
  from: "hi@shop.example",
  to: ["buyer@customer.example"],
  subject: "Invoice 12",
  text: "Thanks for your order.",
  messageId: "abc123@shop.example",
  date: new Date("2026-09-22T10:00:00.000Z"),
};

/** Unfold + decode the `Subject:` encoded-word. */
function subjectOf(raw: string): string {
  const unfolded = raw.replace(/\r\n[ \t]+/g, " ");
  const words = [...unfolded.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].map((m) => m[1]);
  return words.length > 0 ? Buffer.from(words.join(""), "base64").toString("utf8") : /Subject: (.*)\r\n/.exec(unfolded)?.[1] ?? "";
}

function partsOf(raw: string): string[] {
  return raw.split(/\r\n--_mv_[^\r\n]*/).slice(1, -1);
}

function textOf(chunk: string): string {
  const body = chunk.slice(chunk.indexOf("\r\n\r\n") + 4).trim();
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
}

describe("outbound MIME", () => {
  it("is a CRLF message with the addressing a client expects", () => {
    const raw = buildOutboundMime(base);
    expect(raw).toMatch(/\r\n$/);
    expect(raw.startsWith("From: hi@shop.example\r\nTo: buyer@customer.example\r\n")).toBe(true);
    expect(raw).toContain("Date: Tue, 22 Sep 2026 10:00:00 +0000");
    expect(raw).toContain("Message-ID: <abc123@shop.example>");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(subjectOf(raw)).toBe("Invoice 12");
    expect(textOf(raw.slice(raw.indexOf("Content-Type: text/plain")))).toBe("Thanks for your order.");
  });

  it("keeps a Vietnamese subject and body intact through one round trip", () => {
    const raw = buildOutboundMime({
      ...base,
      subject: "Hoá đơn tháng Chín",
      text: "Cảm ơn bạn đã mua hàng. Tổng: 1.500.000đ",
    });
    expect(subjectOf(raw)).toBe("Hoá đơn tháng Chín");
    expect(textOf(raw.slice(raw.indexOf("Content-Type: text/plain")))).toBe("Cảm ơn bạn đã mua hàng. Tổng: 1.500.000đ");
  });

  it("prefers the plain part and puts HTML second when both exist", () => {
    const raw = buildOutboundMime({ ...base, html: "<p>Thanks</p>" });
    const chunks = partsOf(raw);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("text/plain");
    expect(chunks[1]).toContain("text/html");
    expect(textOf(chunks[1] ?? "")).toBe("<p>Thanks</p>");
    expect(raw).toContain(`boundary="_mv_${base.messageId.replace(/[^A-Za-z0-9]/g, "")}"`);
  });

  it("carries the reply bookkeeping, wrapped in the angle brackets the headers require", () => {
    const raw = buildOutboundMime({ ...base, inReplyTo: "root@shop.example", references: ["first@other.example", "root@shop.example"] });
    expect(raw).toContain("In-Reply-To: <root@shop.example>");
    expect(raw).toContain("References: <first@other.example> <root@shop.example>");
  });

  it("names the display sender without losing the address it signs for", () => {
    const raw = buildOutboundMime({ ...base, fromName: "Cửa hàng của Tú", replyTo: "support@shop.example" });
    const fromLine = /^From: (.*)$/m.exec(raw.replace(/\r\n[ \t]+/g, " "))?.[1] ?? "";
    expect(fromLine.endsWith("<hi@shop.example>")).toBe(true);
    expect(/=\?UTF-8\?B\?/.test(fromLine)).toBe(true);
    expect(Buffer.from(/\?B\?([^?]*)\?=/.exec(fromLine)?.[1] ?? "", "base64").toString("utf8")).toBe("Cửa hàng của Tú");
    expect(raw).toContain("Reply-To: support@shop.example");
    expect(raw).toContain("To: buyer@customer.example");
  });

  it("never writes Bcc into the message that gets stored", () => {
    const raw = buildOutboundMime({ ...base, bcc: ["hidden@elsewhere.example"], cc: ["partner@customer.example"] });
    expect(raw).not.toContain("hidden@elsewhere.example");
    expect(raw).toContain("Cc: partner@customer.example");
  });

  it("keeps a boundary safe when the message id carries punctuation", () => {
    const raw = buildOutboundMime({ ...base, messageId: "<weird/id+1@shop.example>", html: "<b>hi</b>" });
    const boundary = /boundary="([^"]+)"/.exec(raw)?.[1];
    expect(boundary).toBeDefined();
    expect(boundary).toMatch(/^_mv_[A-Za-z0-9]+$/);
    expect(raw).toContain(`\r\n--${boundary}\r\n`);
    expect(raw.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });
});

describe("reading addresses out of a header", () => {
  it("prefers what is inside angle brackets", () => {
    expect(addressesOf('GitHub <noreply@github.com>')).toEqual(["noreply@github.com"]);
    expect(addressesOf('"Acme, Inc." <billing@acme.example>, "Other, Co" <ops@other.example>')).toEqual([
      "billing@acme.example",
      "ops@other.example",
    ]);
  });

  it("falls back to a bare list, and normalises case", () => {
    expect(addressesOf("A@B.Example, c@d.example")).toEqual(["a@b.example", "c@d.example"]);
  });

  it("returns nothing usable rather than a wrong address", () => {
    expect(addressesOf("")).toEqual([]);
    expect(addressesOf(null)).toEqual([]);
    expect(addressesOf("no-at-sign-here")).toEqual([]);
  });

  it("collapses the same address written twice", () => {
    expect(addressesOf("<a@b.example>, <A@B.example>")).toEqual(["a@b.example"]);
  });
});

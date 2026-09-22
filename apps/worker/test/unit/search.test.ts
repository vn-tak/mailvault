import { describe, expect, it } from "vitest";
import { parseSearchQuery, hasSearchOperators } from "@mailvault/shared";

/*
 * The operator grammar a mailbox search is expected to have. These are table-driven rather
 * than incidental because the parser has one rule that matters more than any other: an
 * operator nobody recognises must stay a word, because a query that silently turns into
 * "search for nothing" reports an empty mailbox for mail that is there.
 */

const NOW = new Date("2026-09-22T12:00:00.000Z");

describe("search operators", () => {
  it("keeps plain words as text", () => {
    const intent = parseSearchQuery("invoice from etsy", NOW);
    expect(intent.text).toBe("invoice from etsy");
    expect(intent.tokens).toHaveLength(0);
    expect(intent.from).toBeUndefined();
  });

  it("reads an address operator and drops it from the text", () => {
    const intent = parseSearchQuery("from:billing@shop.example receipt", NOW);
    expect(intent.from).toBe("billing@shop.example");
    expect(intent.text).toBe("receipt");
    expect(intent.tokens).toEqual([{ kind: "from", value: "billing@shop.example", raw: "from:billing@shop.example" }]);
  });

  it("keeps a quoted value in one piece", () => {
    const intent = parseSearchQuery('to:"Jane Doe" hello', NOW);
    expect(intent.to).toBe("jane doe");
    expect(intent.text).toBe("hello");
  });

  it("folds the synonyms of has: and is:", () => {
    expect(parseSearchQuery("has:FILES", NOW).hasAttachment).toBe(true);
    expect(parseSearchQuery("has:otp", NOW).hasCode).toBe(true);
    expect(parseSearchQuery("is:starred", NOW).starred).toBe(true);
    // `is:read` is not "not unread" by accident — it is how you look for something you have
    // already handled while still on the unread tab.
    expect(parseSearchQuery("is:read", NOW).unread).toBe(false);
    expect(parseSearchQuery("is:unread", NOW).unread).toBe(true);
  });

  it("names the folder, including the one a rule filed mail into", () => {
    expect(parseSearchQuery("in:sent", NOW).direction).toBe("out");
    expect(parseSearchQuery("in:inbox", NOW).direction).toBe("in");
    expect(parseSearchQuery("in:all", NOW).direction).toBe("all");
    expect(parseSearchQuery("in:archive", NOW).filedOnly).toBe(true);
  });

  it("turns a relative or absolute date into an ISO bound", () => {
    const exact = parseSearchQuery("after:2026-09-01", NOW);
    expect(exact.after).toBe("2026-09-01T00:00:00.000Z");
    const until = parseSearchQuery("before:2026-09-01", NOW);
    // A day named in a search is included, so the bound is the last instant of it.
    expect(until.before).toBe("2026-09-01T23:59:59.999Z");
    expect(parseSearchQuery("after:3d", NOW).after).toBe("2026-09-19T12:00:00.000Z");
  });

  it("leaves anything it does not know in the text", () => {
    const intent = parseSearchQuery("review 20:30 in:whatever has:pizza is:important", NOW);
    expect(intent.text).toBe("review 20:30 in:whatever has:pizza is:important");
    expect(intent.tokens).toHaveLength(0);
    expect(intent.direction).toBeUndefined();
  });

  it("does not treat an operator with no value as a filter", () => {
    const intent = parseSearchQuery("from: meeting", NOW);
    expect(intent.from).toBeUndefined();
    expect(intent.text).toBe("from: meeting");
  });

  it("reports an unparseable date as text rather than no bound at all", () => {
    const intent = parseSearchQuery("after:last tuesday", NOW);
    expect(intent.after).toBeUndefined();
    expect(intent.text).toBe("after:last tuesday");
  });

  it("keeps the raw text of each token so a chip can remove itself", () => {
    const intent = parseSearchQuery("has:attachments is:STARRED", NOW);
    expect(intent.tokens.map((t) => t.raw)).toEqual(["has:attachments", "is:STARRED"]);
    expect(intent.tokens.map((t) => t.value)).toEqual(["attachment", "starred"]);
  });

  it("handles an empty and a whitespace-only query", () => {
    expect(parseSearchQuery(undefined, NOW).text).toBe("");
    expect(parseSearchQuery("   ", NOW).text).toBe("");
  });

  it("notices operators for the UI without deciding anything about them", () => {
    expect(hasSearchOperators("from:x y")).toBe(true);
    expect(hasSearchOperators("just words")).toBe(false);
  });
});

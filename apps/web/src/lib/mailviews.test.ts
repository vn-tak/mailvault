import { describe, expect, it } from "vitest";
import { queryFor, tabBadge, VIEWS } from "./mailviews";
import type { MessageCounters } from "@mailvault/shared";

/**
 * The table that decides what each tab asks the server for. These read like tautologies until
 * one of them is wrong — a Starred tab that quietly filters to received mail, or an Unread tab
 * that also shows filed messages — and then the list is missing mail with no visible reason.
 */

const counters: MessageCounters = {
  inbox: { total: 40, unread: 4 },
  sent: { total: 7, unread: 0 },
  starred: { total: 3, unread: 1 },
  filed: { total: 12, unread: 2 },
  mailboxes: [],
};

const base = { offset: 0, limit: 50, threaded: false };

describe("what each tab asks for", () => {
  it("shows received, unfiled mail by default", () => {
    expect(queryFor("all", base)).toMatchObject({ filter: "all", archived: "active", direction: "in" });
  });

  it("asks for unread without changing anything else", () => {
    expect(queryFor("unread", base)).toMatchObject({ filter: "unread", archived: "active", direction: "in" });
  });

  it("spans both directions on Starred, because marking your own letter is allowed", () => {
    expect(queryFor("starred", base)).toMatchObject({ direction: "all", starred: "true", archived: "active" });
  });

  it("flips the filing and the direction rather than filtering them out", () => {
    expect(queryFor("archived", base)).toMatchObject({ archived: "archived", direction: "in" });
    expect(queryFor("sent", base)).toMatchObject({ archived: "active", direction: "out" });
  });

  it("carries the scope it was given", () => {
    const q = queryFor("all", { ...base, q: "invoice", aliasId: "a1", domainId: "d1", offset: 50, threaded: true });
    expect(q).toMatchObject({ q: "invoice", aliasId: "a1", domainId: "d1", offset: 50, limit: 50, threaded: true });
  });

  it("turns an empty search into no search at all", () => {
    // An empty `q` on the wire would make the Worker run a text match against nothing.
    expect(queryFor("all", { ...base, q: "" }).q).toBeUndefined();
  });
});

describe("the number beside a tab", () => {
  it("counts the mailbox, not the page", () => {
    expect(tabBadge("all", counters)).toBe(4);
    expect(tabBadge("starred", counters)).toBe(3);
    expect(tabBadge("archived", counters)).toBe(12);
    expect(tabBadge("sent", counters)).toBe(7);
  });

  it("leaves Unread unlabelled, because the All tab already carries that number", () => {
    expect(tabBadge("unread", counters)).toBeNull();
  });

  it("has a badge rule for every view the toolbar can draw", () => {
    for (const v of VIEWS) expect(tabBadge(v, counters), v).not.toBeUndefined();
  });
});

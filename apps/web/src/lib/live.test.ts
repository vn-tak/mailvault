import { describe, expect, it } from "vitest";
import { isNewMailMessage, liveUrl } from "./live";

describe("liveUrl", () => {
  it("swaps the scheme and points at the live route on the same origin", () => {
    expect(liveUrl("https://mail.tungjp.store/#/inbox")).toBe("wss://mail.tungjp.store/api/live");
    expect(liveUrl("http://localhost:8787/#/aliases")).toBe("ws://localhost:8787/api/live");
  });

  it("drops query and hash so a filter in the URL cannot change where the socket goes", () => {
    expect(liveUrl("https://mail.tungjp.store/?next=/x#/inbox?domain=1")).toBe("wss://mail.tungjp.store/api/live");
  });

  it("keeps a port, which is how the local dev server reaches it", () => {
    expect(liveUrl("https://example.test:8443/")).toBe("wss://example.test:8443/api/live");
  });
});

describe("isNewMailMessage", () => {
  it("accepts only the nudge", () => {
    expect(isNewMailMessage(JSON.stringify({ type: "new-mail" }))).toBe(true);
  });

  it("ignores the handshake, the keepalive and anything unrecognised", () => {
    for (const raw of ['{"type":"hello"}', '{"type":"pong"}', "{}", ""]) {
      expect(isNewMailMessage(raw), raw).toBe(false);
    }
  });

  it("treats a nudge carrying unexpected fields as a nudge, because the client reads none of them", () => {
    // The refetch goes through the authenticated API, so whatever a frame claims to carry
    // is ignored either way.
    expect(isNewMailMessage('{"type":"new-mail","subject":"hi"}')).toBe(true);
  });

  it("does not throw on a frame that is not JSON, and does not treat a string as a nudge", () => {
    expect(isNewMailMessage("not json")).toBe(false);
    expect(isNewMailMessage('"new-mail"')).toBe(false);
    expect(isNewMailMessage("null")).toBe(false);
  });
});

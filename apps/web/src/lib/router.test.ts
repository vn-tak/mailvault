import { describe, expect, it } from "vitest";
import { matchRoute } from "./router";

describe("matchRoute", () => {
  it("extracts params", () => {
    expect(matchRoute("/messages/:id", "/messages/abc123")).toEqual({ id: "abc123" });
  });
  it("decodes URI components", () => {
    expect(matchRoute("/messages/:id", "/messages/a%2Fb")).toEqual({ id: "a/b" });
  });
  it("rejects segment-count mismatch", () => {
    expect(matchRoute("/messages/:id", "/messages")).toBeNull();
    expect(matchRoute("/messages/:id", "/messages/a/b")).toBeNull();
  });
  it("rejects literal mismatch", () => {
    expect(matchRoute("/messages/:id", "/folders/a")).toBeNull();
  });
  it("matches literal-only patterns", () => {
    expect(matchRoute("/inbox", "/inbox")).toEqual({});
  });
});

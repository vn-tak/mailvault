import { describe, expect, it } from "vitest";
import { formatBytes, relativeTime, senderName } from "./format";

describe("formatBytes", () => {
  it("formats common magnitudes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("treats null/undefined/negative as 0 B", () => {
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});

describe("relativeTime", () => {
  it("returns empty for missing input", () => {
    expect(relativeTime("")).toBe("");
    expect(relativeTime(null)).toBe("");
    expect(relativeTime(undefined)).toBe("");
  });
  it("buckets recent timestamps", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 5_000).toISOString())).toBe("just now");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });
});

describe("senderName", () => {
  it("prefers the display name", () => {
    expect(senderName("GitHub <noreply@github.com>", "x@y.z")).toBe("GitHub");
  });
  it("falls back to the address when no display name", () => {
    expect(senderName("noreply@github.com", "z")).toBe("noreply@github.com");
  });
  it("handles quoted display names", () => {
    expect(senderName('"Acme, Inc." <no-reply@acme.com>', "z")).toBe("Acme, Inc.");
  });
  it("falls back to the provided fallback", () => {
    expect(senderName(null, "envelope@host")).toBe("envelope@host");
  });
});

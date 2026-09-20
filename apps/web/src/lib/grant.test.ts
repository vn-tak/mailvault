import { afterEach, describe, expect, it } from "vitest";
import { ApiClientError } from "./api";
import { clearGrant, grantHeaders, rememberGrant, secondsLeft, STEP_UP_HEADER } from "./grant";
import { needsStepUp } from "./passkeys";

describe("grant store", () => {
  afterEach(clearGrant);

  it("sends the header while the unlock is live", () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    rememberGrant("tok", later);
    expect(grantHeaders()[STEP_UP_HEADER]).toBe("tok");
    expect(secondsLeft()).toBeGreaterThan(50);
  });

  it("drops an expired unlock instead of replaying it", () => {
    rememberGrant("tok", new Date(Date.now() - 1000).toISOString());
    expect(grantHeaders()[STEP_UP_HEADER]).toBeUndefined();
    expect(secondsLeft()).toBe(0);
  });

  it("sends nothing when there is no grant, and rejects a malformed expiry", () => {
    expect(grantHeaders()).toEqual({});
    rememberGrant("tok", "not-a-date");
    expect(grantHeaders()).toEqual({});
    rememberGrant("", new Date(Date.now() + 60_000).toISOString());
    expect(grantHeaders()).toEqual({});
  });
});

describe("needsStepUp", () => {
  it("recognises only the server's own refusal", () => {
    expect(needsStepUp(new ApiClientError(403, "FORBIDDEN", "Unlock with your passkey first", { stepUpRequired: true }))).toBe(true);
    expect(needsStepUp(new ApiClientError(403, "FORBIDDEN", "not allowed"))).toBe(false);
    expect(needsStepUp(new ApiClientError(401, "UNAUTHORIZED", "sign in"))).toBe(false);
    expect(needsStepUp(new Error("boom"))).toBe(false);
    expect(needsStepUp(undefined)).toBe(false);
  });
});

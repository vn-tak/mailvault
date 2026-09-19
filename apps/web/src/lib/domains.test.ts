import { describe, expect, it } from "vitest";
import {
  ConflictType,
  MailStatus,
  PreflightClassification,
  RoutingStatus,
  CatchAllStatus,
  type Domain,
  type PreflightResult,
  type ProvisionOutcome,
} from "@mailvault/shared";
import { bucketOf, isRoutingNotEnabledReceipt, needsOwnerEnable, routingConsoleUrl } from "./domains";

const ACCT = "ef250a88911fd24073cb73d1c07e0218";

function domain(over: Partial<Domain> = {}): Domain {
  return {
    id: "d1",
    cloudflareZoneId: "z1",
    cloudflareAccountId: ACCT,
    name: "example.com",
    zoneStatus: "active",
    zoneType: "full",
    mailStatus: MailStatus.Discovered,
    routingStatus: RoutingStatus.Unknown,
    catchAllStatus: CatchAllStatus.Unknown,
    conflictType: ConflictType.None,
    conflictDetails: null,
    lastCheckedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function preflight(over: Partial<PreflightResult> = {}): PreflightResult {
  return {
    domainId: "d1",
    zoneId: "z1",
    name: "example.com",
    classification: PreflightClassification.ReadyToProvision,
    safeToProvision: true,
    conflict: null,
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function outcome(over: Partial<ProvisionOutcome> = {}): ProvisionOutcome {
  return { domainId: "d1", zoneId: "z1", name: "example.com", status: MailStatus.Ready, ok: true, error: null, steps: [], ...over };
}

describe("routingConsoleUrl", () => {
  it("links to the account-level Email Routing console", () => {
    expect(routingConsoleUrl(domain())).toBe(`https://dash.cloudflare.com/${ACCT}/email-service/routing`);
  });
  it("returns null when the account id is unknown", () => {
    expect(routingConsoleUrl(domain({ cloudflareAccountId: null }))).toBeNull();
  });
});

describe("needsOwnerEnable", () => {
  it("is false once the domain is READY", () => {
    expect(needsOwnerEnable(domain({ mailStatus: MailStatus.Ready }))).toBe(false);
  });
  it("is true for a fresh zone the owner still has to enable", () => {
    expect(needsOwnerEnable(domain({ mailStatus: MailStatus.Discovered }))).toBe(true);
    expect(needsOwnerEnable(domain(), preflight())).toBe(true);
  });
  it("is false when there is no account id to link to", () => {
    expect(needsOwnerEnable(domain({ cloudflareAccountId: null }))).toBe(false);
  });
  it("never suggests enabling routing over a foreign MX", () => {
    expect(
      needsOwnerEnable(
        domain({ mailStatus: MailStatus.Conflict, conflictType: ConflictType.Mx }),
        preflight({ classification: PreflightClassification.MxConflict, safeToProvision: false }),
      ),
    ).toBe(false);
  });
});

describe("bucketOf", () => {
  it("classifies by the freshest evidence", () => {
    expect(bucketOf(domain())).toBe("unconfigured");
    expect(bucketOf(domain(), preflight())).toBe("ready");
    expect(bucketOf(domain(), preflight({ classification: PreflightClassification.MxConflict, safeToProvision: false }))).toBe("conflict");
    expect(bucketOf(domain({ mailStatus: MailStatus.Failed }), undefined, outcome({ ok: false }))).toBe("error");
    expect(bucketOf(domain({ mailStatus: MailStatus.Ready }))).toBe("ready");
  });
});

describe("isRoutingNotEnabledReceipt", () => {
  it("matches the worker's actionable enable message", () => {
    expect(
      isRoutingNotEnabledReceipt(
        outcome({ ok: false, error: "Email Routing is not enabled for this domain, and MailVault's API token is not permitted to enable it. Enable Email Routing once for this zone in the Cloudflare dashboard, then click Retry." }),
      ),
    ).toBe(true);
  });
  it("does not match unrelated failures", () => {
    expect(isRoutingNotEnabledReceipt(outcome({ ok: false, error: "Post-provision verification failed" }))).toBe(false);
    expect(isRoutingNotEnabledReceipt(outcome())).toBe(false);
  });
});

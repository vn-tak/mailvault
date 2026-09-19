import {
  MailStatus,
  PreflightClassification,
  type Domain,
  type PreflightResult,
  type ProvisionOutcome,
} from "@mailvault/shared";

/** Coarse bucket used by the Domains filter. */
export type Bucket = "ready" | "conflict" | "error" | "unconfigured" | "other";

export const FILTERS: Array<{ id: Bucket | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "conflict", label: "Conflict" },
  { id: "error", label: "Error" },
  { id: "unconfigured", label: "Unconfigured" },
];

export function bucketOf(d: Domain, pf?: PreflightResult, oc?: ProvisionOutcome): Bucket {
  const cls = pf?.classification;
  if (cls === PreflightClassification.MxConflict || cls === PreflightClassification.CatchAllConflict) return "conflict";
  if (cls === PreflightClassification.ReadyToProvision) return "ready";
  if (d.mailStatus === MailStatus.Conflict) return "conflict";
  if (d.mailStatus === MailStatus.Failed || (oc && !oc.ok)) return "error";
  if (d.mailStatus === MailStatus.Ready || cls === PreflightClassification.AlreadyConfigured) return "ready";
  if (d.mailStatus === MailStatus.Discovered || d.mailStatus === MailStatus.Preflight) return "unconfigured";
  return "other";
}

/**
 * Cloudflare's Email Routing console is account-level (a zone-scoped path 404s), so
 * the deep link is built from the account id stored on the domain row.
 */
export function routingConsoleUrl(d: Domain): string | null {
  return d.cloudflareAccountId ? `https://dash.cloudflare.com/${d.cloudflareAccountId}/email-service/routing` : null;
}

/**
 * True when a provision receipt is the "routing could not be enabled" case. Only this
 * failure benefits from a dashboard link, and the advice there is about the token's
 * Zone Resources — enabling routing is not an owner-only step.
 */
export function isRoutingNotEnabledReceipt(o: ProvisionOutcome): boolean {
  return !!o.error && /Email Routing is not enabled for this domain/i.test(o.error);
}

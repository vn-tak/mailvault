import type { PreflightResult, ConflictDetails } from "@mailvault/shared";
import { ConflictType, PreflightClassification } from "@mailvault/shared";
import { CloudflareApiError, type CloudflareClient } from "../cf/api-client";
import { log } from "../lib/logging";
import { nowIso } from "../lib/util";
import { assessMx } from "./mx";

export interface PreflightZoneInput {
  zoneId: string;
  name: string;
  status: string;
  type: string;
}

type Settled<T> = { ok: true; value: T } | { ok: false; err: unknown };

/** Run one read without letting it reject its Promise.all siblings. */
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, err };
  }
}

function isDenied(err: unknown): boolean {
  return err instanceof CloudflareApiError && (err.kind === "auth" || err.kind === "permission");
}

function classifyError(err: unknown): PreflightResult | null {
  if (err instanceof CloudflareApiError) {
    if (err.kind === "auth" || err.kind === "permission") {
      return {
        zoneId: "",
        name: "",
        domainId: null,
        classification: PreflightClassification.ApiPermissionError,
        safeToProvision: false,
        conflict: null,
        checkedAt: nowIso(),
      };
    }
  }
  return null;
}

/**
 * Read-only preflight (section 7). Performs NO mutation. Returns a classification
 * plus the evidence needed to render conflict UI (existing MX / foreign catch-all).
 */
export async function preflightZone(
  client: CloudflareClient,
  zone: PreflightZoneInput,
  workerName: string,
): Promise<PreflightResult> {
  const base = { zoneId: zone.zoneId, name: zone.name, domainId: null as string | null, checkedAt: nowIso() };

  // Cheap, DNS-independent gates first.
  if (zone.status !== "active") {
    return { ...base, classification: PreflightClassification.ZoneInactive, safeToProvision: false, conflict: null };
  }
  if (zone.type !== "full") {
    return { ...base, classification: PreflightClassification.UnsupportedZone, safeToProvision: false, conflict: null };
  }

  let assessed: ReturnType<typeof assessMx>;
  let routingReady: boolean;
  let catchAllOurs: boolean;
  let catchAllPresentAndNotOurs: boolean;
  let caAction: { type?: string; value?: string[] } | undefined;
  try {
    const [mxRecords, routingRes, catchAll] = await Promise.all([
      client.listDnsRecords(zone.zoneId, "MX"),
      settle(client.getEmailRoutingStatus(zone.zoneId)),
      client.getCatchAll(zone.zoneId),
    ]);
    assessed = assessMx(mxRecords);

    if (routingRes.ok) {
      routingReady = routingRes.value.enabled === true || /ready/i.test(routingRes.value.status ?? "");
    } else if (isDenied(routingRes.err)) {
      // Re-measured after widening the token's Zone Resources: `POST .../enable` then
      // works, but this settings read still 403s — no API-token permission covers it.
      // Fall back to the observable truth in DNS: Cloudflare only publishes
      // route*.mx.cloudflare.net records once Email Routing is on for the zone.
      log.warn("preflight_routing_settings_unreadable", { zoneId: zone.zoneId, fallback: "mx" });
      routingReady = assessed.cloudflareRouting > 0;
    } else {
      throw routingRes.err;
    }

    caAction = catchAll?.actions?.[0];
    catchAllOurs = !!caAction && caAction.type === "worker" && caAction.value?.[0] === workerName;
    catchAllPresentAndNotOurs =
      !!catchAll && catchAll.enabled !== false && !!caAction && !catchAllOurs && caAction.type !== "drop";
  } catch (err) {
    // Read-only diagnostics: which Cloudflare response made us stop. Safe fields only
    // (no headers, no token) — see lib/logging.
    if (err instanceof CloudflareApiError) {
      log.warn("preflight_read_failed", {
        zoneId: zone.zoneId,
        path: err.path ?? null,
        kind: err.kind,
        status: err.status ?? null,
        cfCodes: err.cfCodes ?? null,
        detail: err.message.slice(0, 200),
      });
    }
    const mapped = classifyError(err);
    if (mapped) return { ...mapped, zoneId: zone.zoneId, name: zone.name };
    throw err;
  }

  if (!assessed.clearForUs) {
    const conflict: ConflictDetails = {
      type: ConflictType.Mx,
      message: `Existing MX detected (${assessed.providers.join(", ") || "unrecognized provider"}).`,
      mxRecords: assessed.foreign.map((f) => ({ exchange: f.exchange, priority: f.priority })),
    };
    return { ...base, classification: PreflightClassification.MxConflict, safeToProvision: false, conflict };
  }

  if (catchAllPresentAndNotOurs) {
    const conflict: ConflictDetails = {
      type: ConflictType.CatchAll,
      message: `Catch-all already routes to ${caAction?.type === "worker" ? "a different Worker" : "another destination"}.`,
      catchAll: { actionType: caAction?.type, destination: caAction?.value?.[0] },
    };
    return { ...base, classification: PreflightClassification.CatchAllConflict, safeToProvision: false, conflict };
  }

  if (routingReady && catchAllOurs) {
    return { ...base, classification: PreflightClassification.AlreadyConfigured, safeToProvision: false, conflict: null };
  }

  return { ...base, classification: PreflightClassification.ReadyToProvision, safeToProvision: true, conflict: null };
}

import type { PreflightResult, ProvisionOutcome } from "@mailvault/shared";
import { CatchAllStatus, ConflictType, MailStatus, PreflightClassification, RoutingStatus } from "@mailvault/shared";
import type { CloudflareClient } from "../cf/api-client";
import { CloudflareApiError } from "../cf/api-client";
import { getDomainByZoneId, patchDomainProvisioning, recordProvisioningEvent } from "../db/domains";
import { log } from "../lib/logging";
import { mapWithConcurrency, newId } from "../lib/util";
import { preflightZone } from "./preflight";
import { assessMx } from "./mx";

export interface ProvisionOptions {
  /** Owner explicitly confirmed replacing a foreign catch-all. Never enables MX takeover. */
  allowCatchAllTakeover?: boolean;
}

interface Step {
  step: string;
  ok: boolean;
  detail?: string | null;
}

/**
 * Idempotent provisioning state machine (section 8). Runs only after an explicit,
 * authenticated owner action — never on startup. Existing third-party MX is ALWAYS
 * skipped (safe-stop); a foreign catch-all may be replaced only with confirmation.
 */
export async function provisionDomain(
  db: D1Database,
  client: CloudflareClient,
  zoneId: string,
  workerName: string,
  opts: ProvisionOptions = {},
): Promise<ProvisionOutcome> {
  const domain = await getDomainByZoneId(db, zoneId);
  if (!domain) {
    return outcome(zoneId, "", null, MailStatus.Failed, false, "Domain not synced yet — run Sync first", []);
  }
  const steps: Step[] = [];
  await patchDomainProvisioning(db, zoneId, { mailStatus: MailStatus.Provisioning });
  await recordProvisioningEvent(db, domain.id, "provision:start", "RUNNING");

  try {
    const pf = await preflightZone(client, { zoneId, name: domain.name, status: domain.zoneStatus, type: domain.zoneType }, workerName);

    // Blocking conflicts: MX is never auto-overwritten. Catch-all only with confirm.
    if (pf.classification === PreflightClassification.MxConflict) {
      await patchDomainProvisioning(db, zoneId, {
        mailStatus: MailStatus.Conflict,
        conflictType: ConflictType.Mx,
        conflictDetails: pf.conflict,
      });
      await recordProvisioningEvent(db, domain.id, "preflight:mx_conflict", "CONFLICT", pf.conflict);
      return outcome(zoneId, domain.name, domain.id, MailStatus.Conflict, false, pf.conflict?.message ?? "MX conflict", steps);
    }
    if (pf.classification === PreflightClassification.CatchAllConflict && !opts.allowCatchAllTakeover) {
      await patchDomainProvisioning(db, zoneId, {
        mailStatus: MailStatus.Conflict,
        conflictType: ConflictType.CatchAll,
        conflictDetails: pf.conflict,
      });
      await recordProvisioningEvent(db, domain.id, "preflight:catch_all_conflict", "CONFLICT", pf.conflict);
      return outcome(zoneId, domain.name, domain.id, MailStatus.Conflict, false, pf.conflict?.message ?? "Catch-all conflict", steps);
    }

    // Allow-list gate: mutate ONLY for classifications we have positively cleared.
    // Anything else — MX conflict, inactive/unsupported zone, and especially a
    // permission/auth error from a preflight read — stops here. A token that cannot
    // *see* the zone must never be allowed to *change* it (section 7/9).
    const provisionable =
      pf.classification === PreflightClassification.ReadyToProvision ||
      pf.classification === PreflightClassification.AlreadyConfigured ||
      (pf.classification === PreflightClassification.CatchAllConflict && opts.allowCatchAllTakeover === true);
    if (!provisionable) {
      await patchDomainProvisioning(db, zoneId, {
        mailStatus: pf.conflict ? MailStatus.Conflict : MailStatus.Failed,
        conflictType: pf.conflict?.type ?? ConflictType.None,
        conflictDetails: pf.conflict ?? null,
      });
      await recordProvisioningEvent(db, domain.id, "provision:blocked", "BLOCKED", { classification: pf.classification });
      return outcome(zoneId, domain.name, domain.id, MailStatus.Failed, false, `Not safe to provision (${pf.classification})`, steps);
    }

    const skipDns = pf.classification === PreflightClassification.AlreadyConfigured;

    // ensureEmailRoutingDns — adds+locks CF MX/SPF + enables. Skipped when the zone
    // already publishes Cloudflare's routing MX: re-enabling is a redundant mutation
    // (and the enable endpoint is not token-authorizable in every account).
    let routingOn = skipDns;
    if (!routingOn) {
      const mxNow = await client.listDnsRecords(zoneId, "MX");
      routingOn = assessMx(mxNow).cloudflareRouting > 0;
    }

    if (routingOn) {
      steps.push({ step: "email_routing_dns", ok: true, detail: skipDns ? "already enabled" : "mx present" });
    } else {
      await client.enableEmailRouting(zoneId);
      steps.push({ step: "email_routing_dns", ok: true });
    }
    await patchDomainProvisioning(db, zoneId, { mailStatus: MailStatus.Provisioning });

    // ensureCatchAllWorkerRule — PUT catch_all -> our worker. Idempotent (sets ours).
    await client.setCatchAllWorker(zoneId, workerName);
    steps.push({ step: "catch_all_worker", ok: true, detail: opts.allowCatchAllTakeover && pf.classification === PreflightClassification.CatchAllConflict ? "took over foreign catch-all" : null });
    await patchDomainProvisioning(db, zoneId, { mailStatus: MailStatus.Verifying });

    // verify (section 33) — do not claim READY off a single 200.
    let routingOk: boolean;
    try {
      const routing = await client.getEmailRoutingStatus(zoneId);
      routingOk = routing.enabled === true || /ready/i.test(routing.status ?? "");
    } catch (err) {
      if (!(err instanceof CloudflareApiError) || (err.kind !== "auth" && err.kind !== "permission")) throw err;
      // Same fallback as preflight: Cloudflare only publishes routing MX when on.
      routingOk = assessMx(await client.listDnsRecords(zoneId, "MX")).cloudflareRouting > 0;
    }
    const catchAll = await client.getCatchAll(zoneId);
    const ca = catchAll?.actions?.[0];
    const catchAllOk = !!ca && ca.type === "worker" && ca.value?.[0] === workerName;
    steps.push({ step: "verify", ok: routingOk && catchAllOk, detail: `routing=${routingOk} catch_all=${catchAllOk}` });

    const routingStatus = routingOk ? RoutingStatus.Ready : RoutingStatus.Misconfigured;
    const catchAllStatus = catchAllOk ? CatchAllStatus.Ours : CatchAllStatus.Foreign;

    if (routingOk && catchAllOk) {
      await patchDomainProvisioning(db, zoneId, {
        mailStatus: MailStatus.Ready,
        routingStatus,
        catchAllStatus,
        conflictType: ConflictType.None,
        conflictDetails: null,
      });
      await recordProvisioningEvent(db, domain.id, "provision:ready", "READY");
      log.info("domain_ready", { zoneId });
      return outcome(zoneId, domain.name, domain.id, MailStatus.Ready, true, null, steps);
    }

    await patchDomainProvisioning(db, zoneId, { mailStatus: MailStatus.Failed, routingStatus, catchAllStatus });
    await recordProvisioningEvent(db, domain.id, "provision:verify_failed", "FAILED");
    return outcome(zoneId, domain.name, domain.id, MailStatus.Failed, false, "Post-provision verification failed", steps);
  } catch (err) {
    const kind = err instanceof CloudflareApiError ? err.kind : "error";
    const message = err instanceof CloudflareApiError ? err.message : "Provisioning error";
    if (err instanceof CloudflareApiError) {
      log.warn("provision_step_failed", {
        zoneId,
        path: err.path ?? null,
        kind: err.kind,
        status: err.status ?? null,
        cfCodes: err.cfCodes ?? null,
        completedSteps: steps.map((s) => s.step),
      });
    }
    await patchDomainProvisioning(db, zoneId, {
      mailStatus: MailStatus.Failed,
      conflictType: ConflictType.None,
      conflictDetails: null,
    });
    await recordProvisioningEvent(db, domain.id, "provision:error", "FAILED", { kind });
    log.error("domain_provision_failed", { zoneId, kind });

    // Cloudflare does not expose an API-token permission for enabling Email Routing,
    // so this one step has to be done by the owner. Say so instead of surfacing a
    // bare "Authentication error" that gives the owner nothing to act on.
    const enablePath = err instanceof CloudflareApiError && /\/email\/routing\/(enable|dns)$/.test(err.path ?? "");
    const actionable =
      enablePath && (kind === "permission" || kind === "auth")
        ? "Email Routing is not enabled for this domain, and MailVault's API token is not permitted to enable it. " +
          "Enable Email Routing once for this zone in the Cloudflare dashboard, then click Retry — MailVault will set " +
          "the catch-all and verify. No MX record will be overwritten."
        : message;

    return outcome(zoneId, domain.name, domain.id, MailStatus.Failed, false, actionable, steps);
  }
}

function outcome(
  zoneId: string,
  name: string,
  domainId: string | null,
  status: MailStatus,
  ok: boolean,
  error: string | null,
  steps: Step[],
): ProvisionOutcome {
  return { domainId: domainId ?? "", zoneId, name, status, ok, error, steps };
}

/** Bulk preflight — independent per-domain results (section 32). */
export async function preflightMany(
  db: D1Database,
  client: CloudflareClient,
  zoneIds: string[],
  workerName: string,
): Promise<PreflightResult[]> {
  return mapWithConcurrency(zoneIds, 4, async (zoneId) => {
    const domain = await getDomainByZoneId(db, zoneId);
    if (!domain) {
      return {
        zoneId,
        name: zoneId,
        domainId: null,
        classification: PreflightClassification.ApiPermissionError,
        safeToProvision: false,
        conflict: null,
        checkedAt: new Date().toISOString(),
      } as PreflightResult;
    }
    const pf = await preflightZone(client, { zoneId, name: domain.name, status: domain.zoneStatus, type: domain.zoneType }, workerName);
    return { ...pf, domainId: domain.id };
  });
}

/** Bulk provision — one failure never aborts the others; per-domain receipts. */
export async function provisionMany(
  db: D1Database,
  client: CloudflareClient,
  zoneIds: string[],
  workerName: string,
  opts: ProvisionOptions = {},
): Promise<ProvisionOutcome[]> {
  return mapWithConcurrency(zoneIds, 3, (zoneId) => provisionDomain(db, client, zoneId, workerName, opts));
}

export function newRunId(): string {
  return newId();
}

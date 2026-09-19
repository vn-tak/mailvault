import { Hono } from "hono";
import { z } from "zod";
import { DomainIdsBodySchema, type DiscoveredZone } from "@mailvault/shared";
import type { AppEnv } from "../app-env";
import { getDomainByZoneId, listDomains, upsertDiscoveredZones } from "../db/domains";
import { preflightMany, provisionMany, provisionDomain } from "../provisioning/provisioner";
import { log } from "../lib/logging";
import { badRequest, notFound, AppError } from "../lib/errors";
import { actorOf, asApiError, cfClient, readJson } from "./_helpers";

const ZoneIdParam = z.object({ id: z.string().min(1) });

/** Provision/preflight bodies accept an explicit, dangerous-action takeover confirm. */
const ProvisionBodySchema = DomainIdsBodySchema.extend({
  allowCatchAllTakeover: z.boolean().default(false),
});

function requireWorkerName(env: AppEnv["Bindings"]): string {
  const name = env.MAIL_WORKER_NAME;
  if (!name) {
    throw new AppError(503, "WORKER_NAME_UNSET", "MAIL_WORKER_NAME must be configured so catch-all rules can target this Worker.");
  }
  return name;
}

export const domainsRoute = new Hono<AppEnv>()
  .get("/api/domains", async (c) => c.json({ items: await listDomains(c.env.DB) }))

  /** Discovery is read-only against Cloudflare — it never mutates a zone (section 9). */
  .post("/api/domains/sync", async (c) => {
    try {
      const client = cfClient(c.env);
      const zones = await client.listAllZones();
      const discovered: DiscoveredZone[] = zones.map((z) => ({
        cloudflareZoneId: z.id,
        cloudflareAccountId: z.account?.id ?? c.env.CF_ACCOUNT_ID ?? null,
        name: z.name,
        status: z.status,
        type: z.type,
        account: z.account ? { id: z.account.id ?? null, name: z.account.name ?? null } : null,
      }));
      await upsertDiscoveredZones(c.env.DB, discovered);
      log.info("domains_synced", { actor: actorOf(c).email, discovered: discovered.length });
      return c.json({ discovered: discovered.length, items: await listDomains(c.env.DB) });
    } catch (err) {
      throw asApiError(err);
    }
  })

  /** Preflight classifies safety for each selected zone. Performs no mutation. */
  .post("/api/domains/preflight", async (c) => {
    try {
      const body = await readJson(c, DomainIdsBodySchema);
      const client = cfClient(c.env);
      const workerName = requireWorkerName(c.env);
      const results = await preflightMany(c.env.DB, client, body.zoneIds, workerName);
      return c.json({ results });
    } catch (err) {
      throw asApiError(err);
    }
  })

  /** Provision mutates Cloudflare — only ever after this explicit, authenticated action. */
  .post("/api/domains/provision", async (c) => {
    try {
      const body = await readJson(c, ProvisionBodySchema);
      const client = cfClient(c.env);
      const workerName = requireWorkerName(c.env);
      const results = await provisionMany(c.env.DB, client, body.zoneIds, workerName, {
        allowCatchAllTakeover: body.allowCatchAllTakeover,
      });
      log.info("domains_provisioned", {
        actor: actorOf(c).email,
        count: results.length,
        ok: results.filter((r) => r.ok).length,
        takeover: body.allowCatchAllTakeover,
      });
      return c.json({ results });
    } catch (err) {
      throw asApiError(err);
    }
  })

  /** Retry = provision one domain; :id is the Cloudflare zone id. */
  .post("/api/domains/:id/retry", async (c) => {
    const { id: zoneId } = ZoneIdParam.parse({ id: c.req.param("id") });
    try {
      // Retry may be sent with no body; absence means "no takeover confirmation".
      let allowCatchAllTakeover = false;
      try {
        const body = await readJson(c, z.object({ allowCatchAllTakeover: z.boolean().optional() }));
        allowCatchAllTakeover = body.allowCatchAllTakeover ?? false;
      } catch {
        /* empty/absent body is fine for a retry */
      }
      const client = cfClient(c.env);
      const workerName = requireWorkerName(c.env);
      const result = await provisionDomain(c.env.DB, client, zoneId, workerName, { allowCatchAllTakeover });
      return c.json(result);
    } catch (err) {
      throw asApiError(err);
    }
  })

  /**
   * Forget a domain from MailVault. This ONLY removes local tracking rows —
   * it never deletes or mutates the Cloudflare zone (section: removing must not
   * delete the zone). Refuses while aliases still depend on it to avoid a
   * surprising cascade.
   */
  .delete("/api/domains/:id", async (c) => {
    const { id: zoneId } = ZoneIdParam.parse({ id: c.req.param("id") });
    const domain = await getDomainByZoneId(c.env.DB, zoneId);
    if (!domain) throw notFound("Domain not found");
    const aliasCount = await c.env.DB
      .prepare(`SELECT COUNT(*) AS c FROM aliases WHERE domain_id = ?1`)
      .bind(domain.id)
      .first<{ c: number }>();
    if (Number(aliasCount?.c ?? 0) > 0) {
      throw badRequest("Remove or reassign this domain's aliases before removing it.", { aliasCount: Number(aliasCount?.c ?? 0) });
    }
    await c.env.DB.prepare(`DELETE FROM domains WHERE id = ?1`).bind(domain.id).run();
    log.info("domain_forgotten", { actor: actorOf(c).email, zoneId });
    return c.json({ removed: true, zoneId });
  });

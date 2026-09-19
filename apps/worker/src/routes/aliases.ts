import { Hono } from "hono";
import { z } from "zod";
import {
  AliasStatus,
  CreateAliasSchema,
  DeleteAliasSchema,
  LocalPartMode,
  UpdateAliasSchema,
  isValidLocalPart,
} from "@mailvault/shared";
import type { AppEnv } from "../app-env";
import {
  aliasStats,
  aliasExists,
  createAlias,
  deleteAlias,
  getAliasById,
  listAliases,
  setAliasStatus,
  updateAlias,
} from "../db/aliases";
import { getDomainById } from "../db/domains";
import { conflict, notFound } from "../lib/errors";
import { log } from "../lib/logging";
import { randomLocalPart } from "../lib/util";
import { deleteKeys } from "../storage/r2";
import { actorOf, parseQuery, readJson } from "./_helpers";

const IdParam = z.object({ id: z.string().min(1) });
const ListQuery = z.object({
  q: z.string().max(200).optional(),
  /** Archived aliases are hidden by default so the working list stays short. */
  view: z.enum(["all", "active", "archived"]).default("active"),
});

/**
 * Generate a collision-free random local part. Random/service modes use CSPRNG
 * (never Math.random, section 21); we retry on the rare in-domain clash so the
 * caller never has to. Reserved-name and format checks live in the shared schema.
 */
async function uniqueRandomPart(db: D1Database, domainId: string, prefix: string): Promise<string> {
  for (let i = 0; i < 24; i++) {
    const candidate = prefix ? `${prefix}-${randomLocalPart(6)}` : randomLocalPart(6);
    if (!isValidLocalPart(candidate)) continue;
    if (!(await aliasExists(db, domainId, candidate))) return candidate;
  }
  throw conflict("Could not generate a unique alias — please retry");
}

export const aliasesRoute = new Hono<AppEnv>()
  .get("/api/aliases", async (c) => {
    const { q, view } = parseQuery(c, ListQuery);
    return c.json({ items: await listAliases(c.env.DB, q, view) });
  })

  /** One alias with its arrival history — counts, span and the senders that use it. */
  .get("/api/aliases/:id", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    const alias = await getAliasById(c.env.DB, id);
    if (!alias) throw notFound("Alias not found");
    return c.json({ alias, stats: await aliasStats(c.env.DB, id) });
  })

  .post("/api/aliases", async (c) => {
    const body = await readJson(c, CreateAliasSchema);
    const domain = await getDomainById(c.env.DB, body.domainId);
    if (!domain) throw notFound("Domain not found — sync your domains first");

    let localPart: string;
    if (body.mode === LocalPartMode.Custom) {
      localPart = body.localPart;
    } else if (body.mode === LocalPartMode.ServiceRandom) {
      localPart = await uniqueRandomPart(c.env.DB, domain.id, body.service);
    } else {
      localPart = await uniqueRandomPart(c.env.DB, domain.id, "");
    }

    const alias = await createAlias(c.env.DB, {
      domainId: domain.id,
      domainName: domain.name,
      localPart,
      label: body.label ?? null,
    });
    log.info("alias_created", { actor: actorOf(c).email, aliasId: alias.id, domainId: domain.id, mode: body.mode });
    return c.json(alias, 201);
  })

  /** Label, notes, pin and archive — only the fields present in the body change. */
  .patch("/api/aliases/:id", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    const patch = await readJson(c, UpdateAliasSchema);
    if (!(await getAliasById(c.env.DB, id))) throw notFound("Alias not found");
    await updateAlias(c.env.DB, id, patch);
    log.info("alias_updated", { actor: actorOf(c).email, aliasId: id, fields: Object.keys(patch) });
    return c.json(await getAliasById(c.env.DB, id));
  })

  .post("/api/aliases/:id/enable", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    if (!(await getAliasById(c.env.DB, id))) throw notFound("Alias not found");
    await setAliasStatus(c.env.DB, id, AliasStatus.Active);
    return c.json(await getAliasById(c.env.DB, id));
  })

  .post("/api/aliases/:id/disable", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    if (!(await getAliasById(c.env.DB, id))) throw notFound("Alias not found");
    await setAliasStatus(c.env.DB, id, AliasStatus.Disabled);
    return c.json(await getAliasById(c.env.DB, id));
  })

  /**
   * Delete an alias. With purgeMessages the owner opts into permanently removing
   * that mailbox's stored mail too — we delete DB rows then best-effort purge R2
   * (section 23/24). Without it, messages are preserved and detached (SET NULL).
   */
  .delete("/api/aliases/:id", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    const { purgeMessages } = await readJson(c, DeleteAliasSchema);
    if (!(await getAliasById(c.env.DB, id))) throw notFound("Alias not found");
    const { rawKeys } = await deleteAlias(c.env.DB, id, purgeMessages);
    if (rawKeys.length) await deleteKeys(c.env.MAIL_BUCKET, rawKeys);
    log.info("alias_deleted", { actor: actorOf(c).email, aliasId: id, purgeMessages, r2Keys: rawKeys.length });
    return c.json({ deleted: true, purgedMessages: purgeMessages, r2ObjectsRemoved: rawKeys.length });
  });

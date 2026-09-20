import { Hono } from "hono";
import { z } from "zod";
import { CreateRuleSchema, UpdateRuleSchema } from "@mailvault/shared";
import type { AppEnv } from "../app-env";
import { notFound } from "../lib/errors";
import { log } from "../lib/logging";
import { deleteRule, getRule, insertRule, listRules, updateRule } from "../db/rules";
import { addressReuseReport } from "../db/report";
import { actorOf, readJson } from "./_helpers";

const IdParam = z.object({ id: z.string().min(1) });

/**
 * Mailbox rules and the address-reuse report.
 *
 * A rule can only organise mail — the schemas accept no delete action, and the evaluator
 * has no path to one. Rules never decide whether mail is accepted either; that stays the
 * alias table's job.
 */
export const rulesRoute = new Hono<AppEnv>()
  .get("/api/rules", async (c) => c.json({ items: await listRules(c.env.DB) }))

  .post("/api/rules", async (c) => {
    const body = await readJson(c, CreateRuleSchema);
    const rule = await insertRule(c.env.DB, body.match, body.action, body.enabled);
    log.info("rule_created", { actor: actorOf(c).email, ruleId: rule.id });
    return c.json(rule, 201);
  })

  .patch("/api/rules/:id", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    const body = await readJson(c, UpdateRuleSchema);
    const updated = await updateRule(c.env.DB, id, body);
    if (!updated) throw notFound("Rule not found");
    log.info("rule_updated", { actor: actorOf(c).email, ruleId: id });
    return c.json(updated);
  })

  .delete("/api/rules/:id", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    // Removing a rule leaves the mail it already filed exactly where it is: an archive is
    // a state on the message, not a live effect of the rule.
    if (!(await getRule(c.env.DB, id))) throw notFound("Rule not found");
    await deleteRule(c.env.DB, id);
    log.info("rule_deleted", { actor: actorOf(c).email, ruleId: id });
    return c.json({ removed: true });
  })

  .get("/api/report/address-reuse", async (c) => c.json({ items: await addressReuseReport(c.env.DB) }));

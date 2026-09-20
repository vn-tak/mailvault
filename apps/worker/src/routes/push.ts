import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app-env";
import { countSubscriptions, deleteSubscription, isUsableEndpoint, pushToAll, saveSubscription, vapidPublicKey } from "../push";
import { vapidConfig } from "../env";
import { log } from "../lib/logging";
import { readJson } from "./_helpers";

const SubscribeSchema = z.object({
  endpoint: z.string().min(1).max(2048).refine(isUsableEndpoint, { message: "Push endpoint must be a valid HTTPS URL" }),
  p256dh: z.string().min(10).max(256),
  auth: z.string().min(6).max(256),
  userAgent: z.string().max(256).optional(),
});

const UnsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2048) });

export const pushRoute = new Hono<AppEnv>()
  /**
   * The VAPID public key the browser needs to subscribe. Public by design; absent when
   * push is not configured, which the SPA uses to hide the control.
   */
  .get("/api/push/public-key", (c) => {
    const config = vapidConfig(c.env);
    return c.json({ key: config ? vapidPublicKey(config.jwk) : null });
  })

  .get("/api/push/status", async (c) => {
    const count = await countSubscriptions(c.env.DB);
    return c.json({ enabled: vapidConfig(c.env) !== null, subscriptions: count });
  })

  .post("/api/push/subscribe", async (c) => {
    if (!vapidConfig(c.env)) return c.json({ error: { code: "PUSH_NOT_CONFIGURED", message: "Push is not enabled on this server." } }, 503);
    const input = await readJson(c, SubscribeSchema);
    const id = await saveSubscription(c.env.DB, {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? c.req.header("user-agent") ?? null,
    });
    log.info("push_subscribed", { id });
    return c.json({ id }, 201);
  })

  .post("/api/push/unsubscribe", async (c) => {
    const { endpoint } = await readJson(c, UnsubscribeSchema);
    const removed = await deleteSubscription(c.env.DB, endpoint);
    log.info("push_unsubscribed", { removed });
    return c.json({ removed });
  })

  /** Owner-triggered sanity check. Sends the same payload-free notification as real mail. */
  .post("/api/push/test", async (c) => c.json(await pushToAll(c.env, c.env.DB)));

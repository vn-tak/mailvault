import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { log } from "../lib/logging";

/**
 * `GET /api/live` — upgrade to the owner's websocket hub.
 *
 * Behind the same Access gate as every other `/api/*` route (the handshake carries the
 * session cookie), and it only ever hands out a nudge. A request that is not a websocket
 * upgrade gets 426 rather than a confusing 404, because that is the mistake a client
 * integration actually makes.
 */
export const liveRoute = new Hono<AppEnv>().get("/api/live", async (c) => {
  if ((c.req.header("upgrade") ?? "").toLowerCase() !== "websocket") {
    return c.json({ error: { code: "PRECONDITION_FAILED", message: "This endpoint expects a WebSocket upgrade" } }, 426);
  }
  const actor = c.get("actor");
  if (!actor) return c.json({ error: { code: "UNAUTHORIZED", message: "Sign in first" } }, 401);

  const hub = c.env.MAILBOX_HUB;
  const stub = hub.get(hub.idFromName(actor.email.toLowerCase()));
  // The handshake headers have to reach the object: it reads the websocket key itself.
  const forwarded = new Headers();
  for (const h of ["upgrade", "sec-websocket-version", "sec-websocket-key", "sec-websocket-protocol", "sec-websocket-extensions"]) {
    const v = c.req.header(h);
    if (v) forwarded.set(h, v);
  }
  const res = await stub.fetch(new Request("https://hub/connect", { headers: forwarded }));
  if (res.status !== 101) log.warn("live_upgrade_rejected", { status: res.status });
  return res;
});

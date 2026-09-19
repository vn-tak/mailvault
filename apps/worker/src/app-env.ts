import type { Hono } from "hono";
import type { Env } from "./env";
import type { Actor } from "./auth";

/** Hono environment: D1/R2/Assets + secrets on Bindings, authenticated owner on Variables. */
export type AppEnv = { Bindings: Env; Variables: { actor: Actor } };

export type AppRoutes = Hono<AppEnv>;

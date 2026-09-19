import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { getDashboardStats } from "../db/dashboard";

export const dashboardRoute = new Hono<AppEnv>().get("/api/dashboard", async (c) => {
  const stats = await getDashboardStats(c.env.DB);
  return c.json(stats);
});

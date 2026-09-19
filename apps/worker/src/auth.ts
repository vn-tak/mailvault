import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { allowedEmails, devAuthBypassEnabled } from "./env";

/** Authenticated identity resolved from Cloudflare Access. */
export interface Actor {
  email: string;
  sub: string;
}

// In-isolate cache of JWKS resolvers, keyed by team domain. jose caches keys +
// handles `kid` rotation internally; hoisting keeps that cache warm across requests.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const url = `${teamDomain.replace(/\/+$/, "")}/cdn-cgi/access/certs`;
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, set);
  }
  return set;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return null;
}

/**
 * Validates the Cloudflare Access application JWT (section 28). Prefers the
 * `cf-access-jwt-assertion` header (recommended by Cloudflare) and falls back to the
 * `CF_Authorization` cookie. Validates signature, issuer, audience and expiry via
 * `jose`. Returns null for any unauthenticated or disallowed request.
 *
 * DEV_AUTH_BYPASS only takes effect when ENVIRONMENT is explicitly non-production
 * (see devAuthBypassEnabled) — it cannot be enabled accidentally in production.
 */
export async function verifyAccessIdentity(env: Env, request: Request): Promise<Actor | null> {
  if (devAuthBypassEnabled(env)) {
    return { email: "dev@localhost", sub: "dev" };
  }

  const token = request.headers.get("cf-access-jwt-assertion") ?? readCookie(request, "CF_Authorization");
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!token || !teamDomain || !aud) return null;

  try {
    const { payload } = await jwtVerify(token, jwksFor(teamDomain), {
      issuer: teamDomain.replace(/\/+$/, ""),
      audience: aud,
      clockTolerance: 30,
    });
    const email = (typeof payload.email === "string" ? payload.email : "").toLowerCase();
    const sub = typeof payload.sub === "string" ? payload.sub : email;
    // Service tokens have no email; treat as unauthenticated for this personal app.
    if (!email) return null;

    const allow = allowedEmails(env);
    if (allow.length > 0 && !allow.includes(email)) return null;

    return { email, sub };
  } catch {
    return null;
  }
}

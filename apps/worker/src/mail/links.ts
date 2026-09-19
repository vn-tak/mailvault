import type { VerificationLink } from "@mailvault/shared";

/**
 * Deterministic verification-link extraction (section 18). Collects http(s) links
 * from plaintext and HTML anchors, ranks them by verification context, and returns a
 * small bounded set — never the long tail of tracking links. The system NEVER
 * auto-visits these; the owner clicks explicitly in the UI.
 */

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const ANCHOR_RE = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

const KEYWORDS = [
  "verify",
  "verification",
  "confirm",
  "confirmation",
  "activate",
  "activation",
  "login",
  "signin",
  "sign-in",
  "magic",
  "reset",
  "password",
  "authenticate",
  "account",
  "authorize",
];

const TRACKING_HOSTS = ["doubleclick", "mailchimp", "sendgrid", "list-manage", "track.", "/open.", "/click.", "utm"];

function stripPunctuation(u: string): string {
  return u.replace(/[),.;:!?]+$/g, "").replace(/&amp;/gi, "&");
}

function labelFromContext(anchorText: string | undefined, url: string): string {
  const text = (anchorText ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (text && text.length <= 80 && !/^https?:\/\//i.test(text)) return text;
  const lower = url.toLowerCase();
  if (/reset|password/.test(lower)) return "Reset password";
  if (/verify|confirm|activate|auth/.test(lower)) return "Verify account";
  if (/login|signin|magic/.test(lower)) return "Sign in";
  return "";
}

function score(url: string, context: string): number {
  const hay = `${url} ${context}`.toLowerCase();
  let s = 0.2;
  let hits = 0;
  for (const k of KEYWORDS) if (hay.includes(k)) hits++;
  s += Math.min(0.6, hits * 0.2);
  if (/=|\?/.test(url) && /token|code|otp|key|sig|auth/i.test(url)) s += 0.2;
  // De-prioritize obvious marketing/tracking domains.
  const host = hostOf(url) ?? "";
  if (TRACKING_HOSTS.some((t) => host.includes(t) || url.toLowerCase().includes(t))) s -= 0.4;
  return Math.max(0, Math.min(1, Math.round(s * 100) / 100));
}

function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return h || null;
  } catch {
    return null;
  }
}

export function extractLinks(text: string, html?: string | null): VerificationLink[] {
  const collected = new Map<string, VerificationLink>();

  const add = (rawUrl: string, anchorText?: string, context?: string) => {
    const url = stripPunctuation(rawUrl.trim());
    const hostname = hostOf(url);
    if (!hostname) return; // not a parseable http(s) URL
    const ctx = `${anchorText ?? ""} ${context ?? ""}`.slice(0, 200);
    const link: VerificationLink = {
      url,
      hostname,
      label: labelFromContext(anchorText, url).slice(0, 160),
      score: score(url, ctx),
      context: ctx.replace(/\s+/g, " ").trim().slice(0, 160) || undefined,
    };
    const key = url.replace(/\/$/, "");
    const prev = collected.get(key);
    if (!prev || link.score > prev.score) collected.set(key, link);
  };

  // Bare URLs from plaintext (context = surrounding 80 chars).
  if (text) {
    for (const m of text.matchAll(URL_RE)) {
      const url = m[0];
      const idx = m.index ?? 0;
      add(url, undefined, text.slice(Math.max(0, idx - 80), idx + url.length + 20));
    }
  }

  // Anchors from HTML (href + visible anchor text).
  if (html) {
    for (const m of html.matchAll(ANCHOR_RE)) {
      const href = m[1];
      if (!href || !/^https?:\/\//i.test(href)) continue; // skip mailto:/#
      add(href, m[2]?.replace(/\s+/g, " "));
    }
  }

  return [...collected.values()]
    .filter((l) => l.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

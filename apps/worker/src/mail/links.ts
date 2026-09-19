import type { VerificationLink } from "@mailvault/shared";

/**
 * Deterministic verification-link extraction (section 18). Collects http(s) links from
 * plaintext and HTML anchors, ranks them by verification context, and returns a small
 * bounded set — never the long tail of tracking links. The system NEVER auto-visits
 * these; the owner clicks explicitly in the UI.
 *
 * Three properties matter for a link the owner is about to hand a magic token to:
 * it must be COMPLETE (mailers wrap long URLs across lines), it must be the real
 * DESTINATION (click-through wrappers show a host that is not where the token goes), and
 * the same logical link must not be listed three times.
 */

const URL_START_RE = /https?:\/\/[^\s<>"']+/gi;
/** URL payload characters: everything a mailer may fold a token across except space. */
const URL_CHAR = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+;=%,-]$/;
/** Ends that cannot close a real URL, so the next line is a continuation, not prose. */
const CUT_MID_URL = /[?&=%#/,+]$/;
/** A folded tail is only believable when it carries query syntax a sentence does not. */
const URLISH_TAIL = /[?&=%#]/;
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

/**
 * Query parameters that carry the real destination when a sender wraps a link. Deliberately
 * narrow: `redirect=link_app` is a value, not a URL, and must never be treated as one.
 */
const DESTINATION_PARAMS = ["url", "u", "d", "dest", "destination", "target", "targeturl", "target_url", "link", "to", "next"];

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

/** Hrefs in HTML anchors arrive entity-encoded; `&amp;` inside a token breaks the link. */
function decodeEntities(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]{1,6})|#([0-9]{1,7})|([a-z]+));/gi, (whole, hex?, dec?, name?) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return code > 31 && code < 1_114_112 ? String.fromCodePoint(code) : whole;
    }
    if (dec) {
      const code = Number.parseInt(dec, 10);
      return code > 31 && code < 1_114_112 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[(name ?? "").toLowerCase()] ?? whole;
  });
}

/**
 * Drop sentence punctuation that ran into the match. A `)` or `]` only counts as trailing
 * when its partner was never opened, so `…/compare(a,b)` keeps its parenthesis while
 * `(see https://x.dev/verify?t=1)` loses the sentence's.
 */
function trimUrl(raw: string): string {
  let u = raw.trim().replace(/["'<>]+$/g, "");
  for (let guard = 0; guard < 6; guard++) {
    const before = u;
    u = u.replace(/[.,;:!?]+$/g, "");
    if (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
    if (u.endsWith("]") && (u.match(/\[/g)?.length ?? 0) < (u.match(/\]/g)?.length ?? 0)) u = u.slice(0, -1);
    if (u === before) break;
  }
  return u;
}

/**
 * A URL folded across a hard line break is only recovered when the fragment stops at a
 * character that cannot end a URL, or the continuation line carries query syntax. Guessing
 * on mid-word breaks would glue the next prose line onto a complete address, and a silently
 * wrong destination is worse than a truncated one the owner can still read in the body.
 */
export function unfoldUrl(text: string, start: number): string {
  let url = "";
  let i = start;
  while (i < text.length && URL_CHAR.test(text[i] ?? "")) url += text[i++];

  for (;;) {
    if (text[i] !== "\n" && text[i] !== "\r") break;
    let j = i;
    while (text[j] === "\n" || text[j] === "\r") j++;
    let tail = "";
    while (j < text.length && URL_CHAR.test(text[j] ?? "")) tail += text[j++];
    if (!tail || (!CUT_MID_URL.test(url) && !URLISH_TAIL.test(tail))) break;
    url += tail;
    i = j;
  }
  return url;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null; // a stray `%` in a subject line is not a reason to lose the link
  }
}

/** An unwrapped destination is only believable as a real, complete http(s) address. */
function asUrl(candidate: string): string | null {
  const trimmed = trimUrl(candidate);
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (!u.hostname.includes(".") || u.hostname.length < 4) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Recover the address a click-through wrapper is standing in front of.
 *
 * SendGrid/Stripe style: `https://m.stripe.com/CL0/https:%2F%2Ftarget…%3Ftoken…/1/01010…`.
 * Inside the encoded blob every slash is `%2F`, so the first literal `/` belongs to the
 * wrapper's own tracking tail. Param style: `?url=https%3A%2F%2F…`.
 */
export function unwrapDestination(url: string): string | null {
  const cl = /^https?:\/\/[^/]+\/CL\d+\/(.*)$/i.exec(url)?.[1];
  if (cl) {
    // Every slash inside the encoded target is `%2F`, so the first literal `/` is where the
    // wrapper's own tracking tail (`/1/01010…`) begins.
    const decoded = safeDecode(cl.split("/")[0] ?? "");
    if (decoded) {
      const direct = asUrl(decoded);
      if (direct) return direct;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const key of DESTINATION_PARAMS) {
    for (const raw of parsed.searchParams.getAll(key)) {
      const decoded = safeDecode(raw);
      if (!decoded) continue;
      const candidate = asUrl(decoded);
      if (candidate && hostOf(candidate) !== hostOf(url)) return candidate;
    }
  }
  return null;
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

/**
 * Collapse two mentions of the same link. The best label, context and score win, but a
 * wrapped address is kept as `url` with its target in `destination`: otherwise a link that
 * arrived behind a tracker would lose the fact, once its honest twin is folded in.
 */
function merge(prev: VerificationLink, next: VerificationLink): VerificationLink {
  const best = next.score > prev.score ? next : prev;
  const other = best === next ? prev : next;
  const wrapped = best.destination ? best : other.destination ? other : best;
  return {
    ...best,
    url: wrapped.url,
    hostname: wrapped.hostname,
    ...(wrapped.destination ? { destination: wrapped.destination } : {}),
    label: best.label || other.label,
    context: best.context ?? other.context,
    score: Math.max(best.score, other.score),
  };
}

export function extractLinks(text: string, html?: string | null): VerificationLink[] {
  const collected = new Map<string, VerificationLink>();

  const add = (rawUrl: string, anchorText?: string, context?: string) => {
    const url = trimUrl(decodeEntities(rawUrl.trim()));
    const hostname = hostOf(url);
    if (!hostname) return; // not a parseable http(s) URL
    const destination = unwrapDestination(url);
    const ctx = `${anchorText ?? ""} ${context ?? ""}`.slice(0, 200);
    const link: VerificationLink = {
      url,
      hostname,
      ...(destination ? { destination } : {}),
      label: labelFromContext(anchorText, destination ?? url).slice(0, 160),
      score: score(destination ?? url, ctx),
      context: ctx.replace(/\s+/g, " ").trim().slice(0, 160) || undefined,
    };
    // One logical link, however many wrappers point at it.
    const key = (destination ?? url).replace(/\/$/, "").toLowerCase();
    const prev = collected.get(key);
    collected.set(key, prev ? merge(prev, link) : link);
  };

  // Bare URLs from plaintext, re-joined across folded lines (context = surrounding text).
  if (text) {
    for (const m of text.matchAll(URL_START_RE)) {
      const start = m.index ?? 0;
      const url = unfoldUrl(text, start);
      add(url, undefined, text.slice(Math.max(0, start - 80), start + url.length + 20));
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

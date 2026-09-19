import type { ExtractedCode } from "@mailvault/shared";

/**
 * Deterministic one-time-code extraction — no AI (section 17). Numeric codes of
 * 4/5/6/8 digits plus common short alphanumeric codes are recognized, weighted by
 * proximity to verification keywords, and aggressively filtered to avoid treating
 * phone numbers, dates, times, order IDs and prices as OTPs.
 */

const STRONG_KEYWORDS = [
  "otp",
  "one-time",
  "one time",
  "verification code",
  "verify",
  "confirmation code",
  "security code",
  "login code",
  "access code",
  "passcode",
  "sign-in code",
  "authentication code",
  "password reset",
  "enter the code",
  "your code is",
  "use this code",
  "code:",
  "code is",
  "pin",
];

const WEAK_KEYWORDS = ["code", "confirm", "authenticate", "verify", "security"];

const NUMERIC_RE = /(?<![A-Za-z0-9])(\d{4,8})(?![A-Za-z0-9])/g;
// Uppercase alnum codes containing at least one digit and one letter, e.g. AB12-3CD.
const ALNUM_RE = /(?<![A-Za-z0-9-])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,6}){0,3}(?![A-Za-z0-9-])/g;

const DIGITS_ONLY_LENGTHS = new Set([4, 5, 6, 8]);

function contextAround(text: string, index: number, length: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end);
}

function hasKeyword(ctx: string): "strong" | "weak" | "none" {
  const lower = ctx.toLowerCase();
  if (STRONG_KEYWORDS.some((k) => lower.includes(k))) return "strong";
  if (WEAK_KEYWORDS.some((k) => lower.includes(k))) return "weak";
  return "none";
}

/** Reject numeric runs that are clearly not a standalone verification code. */
function looksLikeNoise(text: string, index: number, length: number, value: string): boolean {
  const before = text.slice(Math.max(0, index - 2), index);
  const after = text.slice(index + length, index + length + 2);
  const ctx = contextAround(text, index, length, 24);
  const lowerCtx = ctx.toLowerCase();

  // Time: 12:34 / 34:56
  if (/[:]/.test(before) || /[:]/.test(after)) return true;
  // Date fragment: separated by - or / with digits on the other side (e.g. 2026, 12/09)
  if ((/[-/.]$/.test(before) || /^\s*[-/.]/.test(before)) && (/^[-/.]/.test(after))) return true;
  // Phone: leading + anywhere tight, or phone keywords, or tel:
  if (/\+\s?\d?$/.test(before) || /\btel:/i.test(lowerCtx) || /phone|mobile|cell|fax|\bcall\b|\bnumber\b/.test(lowerCtx)) return true;
  // Price / currency adjacency
  if (/[$€£¥]\s*$/.test(before) || /^\s*[$€£¥]/.test(after) || /\b(usd|eur|gbp|jpy|price|total|amount)\b/.test(lowerCtx)) return true;
  // Bare 4-digit year with no keyword context nearby
  if (value.length === 4 && /^(19|20)\d\d$/.test(value)) return true;

  return false;
}

function numericConfidence(value: string, kw: "strong" | "weak" | "none"): number {
  let base: number;
  if (value.length === 6) base = 0.9;
  else if (value.length === 8) base = 0.75;
  else if (value.length === 5) base = 0.72;
  else base = 0.66; // 4-digit
  if (kw === "strong") base += 0.2;
  else if (kw === "weak") base += 0.1;
  else base -= 0.25; // digit run with no verification context is likely noise
  return Math.max(0, Math.min(1, base));
}

function looksLikeAlnumCode(value: string): boolean {
  const compact = value.replace(/-/g, "");
  if (compact.length < 4 || compact.length > 12) return false;
  if (!/\d/.test(compact) || !/[A-Z]/.test(compact)) return false;
  // Reject long mostly-alphabetic runs (words) and anything that reads like an ID hash.
  const letters = (compact.match(/[A-Z]/g) ?? []).length;
  if (letters > compact.length * 0.8) return false;
  return true;
}

function dedupeKey(c: ExtractedCode): string {
  return `${c.kind}:${c.value}`;
}

export function extractOtp(text: string): ExtractedCode[] {
  if (!text) return [];
  const found = new Map<string, ExtractedCode>();

  const add = (c: ExtractedCode) => {
    const key = dedupeKey(c);
    const prev = found.get(key);
    if (!prev || c.confidence > prev.confidence) found.set(key, c);
  };

  // Numeric pass.
  for (const m of text.matchAll(NUMERIC_RE)) {
    const value = m[1];
    if (!value || !DIGITS_ONLY_LENGTHS.has(value.length)) continue;
    const index = m.index ?? 0;
    if (looksLikeNoise(text, index, value.length, value)) continue;
    const ctx = contextAround(text, index, value.length);
    const kw = hasKeyword(ctx);
    const confidence = numericConfidence(value, kw);
    if (confidence < 0.3) continue;
    add({ value, kind: "numeric", length: value.length, confidence: round2(confidence), context: oneLine(ctx) });
  }

  // Alphanumeric pass (only when near a keyword — these are the noisiest).
  for (const m of text.matchAll(ALNUM_RE)) {
    const value = m[1];
    if (!value || !looksLikeAlnumCode(value)) continue;
    const index = m.index ?? 0;
    const ctx = contextAround(text, index, value.length);
    const kw = hasKeyword(ctx);
    if (kw === "none") continue;
    const confidence = round2(kw === "strong" ? 0.8 : 0.6);
    add({ value, kind: "alphanumeric", length: value.replace(/-/g, "").length, confidence, context: oneLine(ctx) });
  }

  return [...found.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

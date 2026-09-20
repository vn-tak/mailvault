import { AuthVerdict } from "@mailvault/shared";

/**
 * Sender authentication assessment (SPF / DKIM / DMARC).
 *
 * A receiver cannot take `Authentication-Results` at face value: the header is part of
 * the message, so an attacker can write `spf=pass` themselves. A pass is therefore only
 * credited as *aligned* when the domain it vouches for is the header-From domain or a
 * parent of it — DMARC's own alignment rule. Anything else is recorded as evidence but
 * never treated as trust.
 */

export const AuthOutcome = {
  Pass: "pass",
  Fail: "fail",
  SoftFail: "softfail",
  Neutral: "neutral",
  None: "none",
  TempError: "temperror",
  PermError: "permerror",
} as const;
export type AuthOutcome = (typeof AuthOutcome)[keyof typeof AuthOutcome];

export type AuthMechanism = "spf" | "dkim" | "dmarc";

export interface AuthEvidence {
  mechanism: AuthMechanism;
  outcome: AuthOutcome;
  /** Domain the result vouches for, as found in the header (`d=`, `header.i=`, `smtp.mailfrom=`). */
  domain: string | null;
  aligned: boolean;
  /** Which `Authentication-Results` issuer reported it (e.g. `google.com`, `cloudflare.com`). */
  reporter: string | null;
}

export interface AuthAssessment {
  verdict: AuthVerdict;
  /** Raw outcomes as reported by the header — honest, but not necessarily aligned. */
  spf: AuthOutcome | null;
  dkim: AuthOutcome | null;
  dmarc: AuthOutcome | null;
  /** Which of those passes actually vouch for the From domain. This is the trust signal. */
  alignedPass: Record<AuthMechanism, boolean>;
  evidence: AuthEvidence[];
  /** Envelope MAIL FROM domain is unrelated to the header From domain. */
  envelopeMismatch: boolean;
  /** No `Authentication-Results` header reached us at all — nothing to judge. */
  observed: boolean;
  reasons: string[];
}

const OUTCOMES = new Set<string>(Object.values(AuthOutcome));

/** Multi-part public suffixes that must not be cut in half by naive registrable-domain logic. */
const KNOWN_MULTI_TLD = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp",
  "ne.jp", "or.jp", "com.br", "com.vn", "net.vn", "org.vn", "co.in", "com.mx", "com.sg",
  "com.hk", "com.tw", "co.kr", "com.my", "com.ph", "co.za", "com.tr", "com.ua", "com.ru",
]);

export function bareDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const fromAngle = /<\s*([^>\s]+@[^>\s]+)\s*>/.exec(value);
  let raw = (fromAngle?.[1] ?? value).trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at >= 0) raw = raw.slice(at + 1);
  raw = raw.replace(/^\.+|\.+$/g, "").trim();
  return raw || null;
}

export function registrableDomain(domain: string | null): string | null {
  if (!domain) return null;
  const labels = domain.split(".").filter(Boolean);
  if (labels.length <= 2) return domain;
  const lastTwo = labels.slice(-2).join(".");
  const cut = KNOWN_MULTI_TLD.has(lastTwo) ? 3 : 2;
  return labels.slice(-cut).join(".");
}

/** `child` equals `parent` or sits underneath it — DMARC relaxed-style alignment. */
export function domainsAlign(child: string | null, parent: string | null): boolean {
  if (!child || !parent) return false;
  if (child === parent) return true;
  return child.endsWith(`.${parent}`);
}

function domainLabel(raw: string): string {
  const value = raw.trim().replace(/^"|"$/g, "");
  const at = value.indexOf("=");
  const candidate = at >= 0 ? value.slice(at + 1) : value;
  return (bareDomain(candidate) ?? candidate).toLowerCase();
}

function parseLine(line: string): { pss: string | null; pairs: Array<{ mech: string; outcome: AuthOutcome; value: string | null }> } {
  const parts = line.split(";").map((p) => p.trim()).filter(Boolean);
  const pss = parts.length > 0 ? bareDomain(parts[0]) : null;
  const pairs: Array<{ mech: string; outcome: AuthOutcome; value: string | null }> = [];
  for (const segment of parts.slice(1)) {
    const tokens = segment.split(/\s+/).filter(Boolean);
    const head = tokens[0];
    if (!head) continue;
    const eq = head.indexOf("=");
    if (eq <= 0) continue;
    const mech = head.slice(0, eq).toLowerCase();
    const outcome = head.slice(eq + 1).toLowerCase();
    if (!OUTCOMES.has(outcome)) continue;
    let value: string | null = null;
    for (const token of tokens.slice(1)) {
      if (/^(d|header\.i|header\.from|smtp\.mailfrom|dtcp|selector)=/i.test(token)) {
        value = token;
        break;
      }
    }
    pairs.push({ mech, outcome: outcome as AuthOutcome, value });
  }
  return { pss, pairs };
}

function collect(authResults: string[], fromDomain: string | null): AuthEvidence[] {
  const evidence: AuthEvidence[] = [];
  for (const line of authResults) {
    const { pss, pairs } = parseLine(line);
    for (const pair of pairs) {
      const vouched = pair.value ? domainLabel(pair.value) : pss;
      evidence.push({
        mechanism: (["spf", "dkim", "dmarc"].includes(pair.mech) ? pair.mech : "dkim") as AuthMechanism,
        outcome: pair.outcome,
        domain: vouched || null,
        aligned: !!vouched && !!fromDomain && domainsAlign(registrableDomain(vouched), registrableDomain(fromDomain)),
        reporter: pss,
      });
    }
  }
  return evidence;
}

const BETTER: Record<string, number> = {
  [AuthOutcome.Pass]: 6,
  [AuthOutcome.Neutral]: 5,
  [AuthOutcome.SoftFail]: 4,
  [AuthOutcome.None]: 3,
  [AuthOutcome.TempError]: 2,
  [AuthOutcome.PermError]: 1,
  [AuthOutcome.Fail]: 0,
};

/** Aligned passes outrank everything; among the rest the most informative result wins. */
function pick(list: AuthOutcome[]): AuthOutcome | null {
  if (list.length === 0) return null;
  const ranked = [...list].sort((a, b) => (BETTER[b] ?? 0) - (BETTER[a] ?? 0));
  return ranked[0] ?? null;
}

export function assessAuth(input: {
  authResults: string[];
  headerFrom: string | null;
  envelopeFrom: string | null;
}): AuthAssessment {
  const fromDomain = bareDomain(input.headerFrom);
  const envelopeDomain = bareDomain(input.envelopeFrom);
  const evidence = collect(input.authResults, fromDomain);
  const found: Record<AuthMechanism, AuthOutcome[]> = { spf: [], dkim: [], dmarc: [] };
  const alignedPass: Record<AuthMechanism, boolean> = { spf: false, dkim: false, dmarc: false };

  for (const item of evidence) {
    found[item.mechanism].push(item.outcome);
    if (item.outcome === AuthOutcome.Pass && item.aligned) alignedPass[item.mechanism] = true;
  }

  const result: Record<AuthMechanism, AuthOutcome | null> = {
    spf: pick(found.spf),
    dkim: pick(found.dkim),
    dmarc: pick(found.dmarc),
  };
  if (alignedPass.spf) result.spf = AuthOutcome.Pass;
  if (alignedPass.dkim) result.dkim = AuthOutcome.Pass;
  if (alignedPass.dmarc) result.dmarc = AuthOutcome.Pass;

  const envelopeMismatch = !!fromDomain && !!envelopeDomain
    ? registrableDomain(fromDomain) !== registrableDomain(envelopeDomain)
    : false;

  const reasons: string[] = [];
  let verdict: AuthVerdict = AuthVerdict.Unverified;
  if (result.dmarc === AuthOutcome.Fail) {
    verdict = AuthVerdict.Spoofed;
    reasons.push("dmarc=fail");
  }
  if (!alignedPass.dmarc && !alignedPass.dkim && !alignedPass.spf) {
    if (verdict !== AuthVerdict.Spoofed) reasons.push("không có kết quả pass nào aligned với domain người gửi");
  } else if (verdict !== AuthVerdict.Spoofed) {
    verdict = AuthVerdict.Trusted;
    if (alignedPass.dmarc) reasons.push("dmarc pass, aligned");
    if (alignedPass.dkim) reasons.push("dkim pass, aligned");
    if (alignedPass.spf) reasons.push("spf pass, aligned");
  }
  if (envelopeMismatch) reasons.push("envelope from khác domain người gửi");

  return {
    verdict,
    spf: result.spf,
    dkim: result.dkim,
    dmarc: result.dmarc,
    alignedPass,
    evidence,
    envelopeMismatch,
    observed: evidence.length > 0,
    reasons,
  };
}

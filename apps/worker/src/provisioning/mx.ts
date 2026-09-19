/**
 * MX conflict classification (section 7). We must never overwrite MX records that
 * belong to another mail provider. Only records produced by Cloudflare Email Routing
 * are treated as "ours".
 */
export interface MxRecord {
  exchange: string;
  priority: number;
}

const PROVIDER_SIGNATURES: Array<{ name: string; re: RegExp }> = [
  { name: "Google Workspace", re: /(aspmx\.l\.google|googlemail\.com|smtp\.google|_netblocks)/i },
  { name: "Microsoft 365 / Outlook", re: /(mail\.protection\.outlook\.com|inbound-\d+\.smtp\.outlook|olc\.protection\.outlook)/i },
  { name: "Zoho", re: /(zoho|zmailserver)/i },
  { name: "Fastmail", re: /(messagingengine\.com|fastmail)/i },
  { name: "Yahoo", re: /(yahoodns\.net|mta-am\d+\?\.mail\.yahoo)/i },
  { name: "Apple iCloud", re: /(mail\.icloud\.com|mx\.mail\.me\.com)/i },
  { name: "Proton Mail", re: /(protonmail)/i },
  { name: "Mimecast", re: /(mimecast)/i },
  { name: "Proofpoint", re: /(pphosted|proofpoint)/i },
  { name: "Barracuda", re: /(barracuda)/i },
  { name: "SolarWinds SpamTitan", re: /(spamtitan|titanofold)/i },
];

// Cloudflare Email Routing inbound MX hosts (ours).
const CLOUDFLARE_ROUTING_MX = /(email-router\.net|emailrouting\.net|mx\.\w*\.?cloudflare)/i;

export function isCloudflareRoutingMx(content: string): boolean {
  return CLOUDFLARE_ROUTING_MX.test(content);
}

export function detectProvider(content: string): string | null {
  const hit = PROVIDER_SIGNATURES.find((p) => p.re.test(content));
  return hit ? hit.name : null;
}

export interface MxAssessment {
  total: number;
  cloudflareRouting: number;
  foreign: Array<MxRecord & { provider: string | null }>;
  /** True when the only third-party mail this domain points at is Cloudflare routing. */
  clearForUs: boolean;
  providers: string[];
}

export function assessMx(records: Array<{ content: string; priority?: number | null }>): MxAssessment {
  const mx = records
    .filter((r) => (r.content ?? "").trim().length > 0)
    .map((r) => ({ exchange: r.content.trim().replace(/\.$/, ""), priority: Number(r.priority ?? 0) }));

  const foreign: MxAssessment["foreign"] = [];
  let cloudflareRouting = 0;
  const providers = new Set<string>();
  for (const rec of mx) {
    if (isCloudflareRoutingMx(rec.exchange)) {
      cloudflareRouting++;
      continue;
    }
    const provider = detectProvider(rec.exchange);
    if (provider) providers.add(provider);
    foreign.push({ ...rec, provider });
  }
  return {
    total: mx.length,
    cloudflareRouting,
    foreign,
    clearForUs: foreign.length === 0,
    providers: [...providers],
  };
}

/**
 * Address normalization for deterministic alias lookup (section 10).
 * Our aliases always use lowercase local parts and domains, so inbound matching
 * lowercases both. Sub-addresses (user+tag) are preserved verbatim (lowercased);
 * we never create '+' aliases, so such recipients simply fail to match and are
 * rejected — which is the safe, intended behavior.
 */

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export interface SplitAddress {
  local: string;
  domain: string;
  valid: boolean;
}

/** Splits at the LAST '@' so odd local parts (quotes, dots) don't break parsing. */
export function splitAddress(address: string): SplitAddress {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return { local: "", domain: "", valid: false };
  }
  return {
    local: trimmed.slice(0, at),
    domain: normalizeDomain(trimmed.slice(at + 1)),
    valid: true,
  };
}

/** Normalized lowercase full address used as the D1 lookup key. */
export function normalizeLookupAddress(address: string): string {
  const { local, domain, valid } = splitAddress(address);
  if (!valid) return "";
  return `${local.toLowerCase()}@${domain}`;
}

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

/**
 * Every bare address in a header value.
 *
 * `Name <a@b>, "Other" <c@d>` is what `From`, `Reply-To` and `To` actually look like after
 * parsing, so taking the last `@` of the whole string would answer a two-recipient message
 * with one address and the wrong domain. Angle brackets win when present; a value without
 * them is treated as a single bare address, which is how these fields arrive from most
 * mailers.
 */
export function addressesOf(value: string | null | undefined): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^>]*)>/g)].map((m) => normalizeLookupAddress(m[1] ?? ""));
  const found = bracketed.filter(Boolean);
  if (found.length > 0) return [...new Set(found)];
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => normalizeLookupAddress(stripDisplayName(part)))
        .filter(Boolean),
    ),
  ];
}

/** `"Acme, Inc." <x@y>` or plain `x@y` — quotes make a naive comma split wrong. */
function stripDisplayName(part: string): string {
  const trimmed = part.trim();
  const quoted = /^"[^"]*"\s*(.*)$/.exec(trimmed);
  if (quoted) return quoted[1] ?? "";
  const colon = trimmed.lastIndexOf(":");
  return colon > 0 && !trimmed.includes("@", colon) ? trimmed.slice(colon + 1) : trimmed;
}

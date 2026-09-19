/** Small, dependency-free primitives shared across the Worker. */

const encoder = new TextEncoder();

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

const LOCAL_PART_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i ambiguity

/**
 * Cryptographically secure random local part. Never uses Math.random() (section 21).
 * Charset is a lowercase alphanumeric subset valid for our local-part rules.
 */
export function randomLocalPart(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += LOCAL_PART_ALPHABET[(bytes[i] as number) % LOCAL_PART_ALPHABET.length];
  }
  // Guarantee the part does not accidentally start/end with a separator (it cannot,
  // since the alphabet is alphanumeric), and keep length within RFC-safe bounds.
  return out.slice(0, 32);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data = typeof input === "string" ? encoder.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) hex += view[i]!.toString(16).padStart(2, "0");
  return hex;
}

export function clampText(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}

/** Collapse whitespace and truncate — used for stored message previews. */
export function toSingleLine(value: string, max = 280): string {
  return clampText(value.replace(/\s+/g, " ").trim(), max);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}

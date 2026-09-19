/**
 * R2 is the authoritative store for message content (section 12). The bucket is a
 * private binding — never exposed via a public URL; all reads go through the
 * authenticated Worker (section 43). These are the only R2 key builders.
 */

export interface R2Paths {
  raw: string;
  parsed: string;
}

export function buildRawKey(domainId: string, aliasId: string, receivedAt: string, messageId: string): string {
  const d = new Date(receivedAt);
  const yyyy = Number.isNaN(d.getTime()) ? "0000" : d.getUTCFullYear().toString().padStart(4, "0");
  const mm = Number.isNaN(d.getTime()) ? "00" : String(d.getUTCMonth() + 1).padStart(2, "0");
  return `raw/${domainId}/${aliasId}/${yyyy}/${mm}/${messageId}.eml`;
}

export function buildParsedKey(messageId: string): string {
  return `parsed/${messageId}.json`;
}

export function buildAttachmentKey(messageId: string, attachmentId: string, safeFilename: string): string {
  return `attachments/${messageId}/${attachmentId}-${safeFilename}`;
}

export async function putRaw(bucket: R2Bucket, key: string, bytes: Uint8Array): Promise<void> {
  await bucket.put(key, bytes as unknown as ArrayBuffer, {
    httpMetadata: { contentType: "message/rfc822" },
  });
}

export async function putParsed(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function putAttachment(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await bucket.put(key, bytes as unknown as ArrayBuffer, {
    httpMetadata: { contentType },
  });
}

export async function getObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

/** Best-effort multi-delete that never throws (used by cleanup / message delete). */
export async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<{ attempted: number; failed: string[] }> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return { attempted: 0, failed: [] };
  try {
    await bucket.delete(unique);
    return { attempted: unique.length, failed: [] };
  } catch {
    // fall back to per-key so one failure doesn't abandon the rest
    const failed: string[] = [];
    for (const k of unique) {
      try {
        await bucket.delete(k);
      } catch {
        failed.push(k);
      }
    }
    return { attempted: unique.length, failed };
  }
}

import PostalMime from "postal-mime";
import type { Address, Attachment as PmAttachment } from "postal-mime";

/** Normalized, storage-ready view of a parsed email (section 16). */
export interface ParsedAttachment {
  filename: string;
  contentType: string;
  contentId: string | null;
  bytes: Uint8Array;
  size: number;
}

export interface ParsedEmail {
  subject: string | null;
  headerFrom: string | null;
  headerTo: string | null;
  date: string | null;
  messageId: string | null;
  text: string | null;
  html: string | null;
  attachments: ParsedAttachment[];
}

function displayMailbox(name: string | undefined, address: string | undefined): string | null {
  if (name && address) return `${name} <${address}>`;
  return address ?? name ?? null;
}

function displayAddress(a: Address | undefined): string | null {
  if (!a) return null;
  if ("group" in a && a.group) {
    const parts = a.group.map((m) => displayMailbox(m.name, m.address)).filter(Boolean);
    return parts.join(", ") || displayMailbox(a.name, undefined);
  }
  return displayMailbox(a.name, a.address);
}

function firstOf(list: Address[] | undefined): string | null {
  if (!list || list.length === 0) return null;
  return list.map(displayAddress).filter(Boolean).join(", ") || null;
}

function toBytes(content: PmAttachment["content"]): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (typeof content === "string") return new TextEncoder().encode(content);
  return new Uint8Array(content);
}

export async function parseMime(raw: Uint8Array): Promise<ParsedEmail> {
  const parsed = await PostalMime.parse(raw);

  let date: string | null = null;
  const rawDate = parsed.date;
  if (rawDate) {
    const d = new Date(rawDate);
    date = Number.isNaN(d.getTime()) ? String(rawDate) : d.toISOString();
  }

  const attachments: ParsedAttachment[] = (parsed.attachments ?? []).map((a) => {
    const bytes = toBytes(a.content);
    return {
      filename: a.filename ?? "attachment",
      contentType: a.mimeType || "application/octet-stream",
      contentId: a.contentId ?? null,
      bytes,
      size: bytes.byteLength,
    };
  });

  return {
    subject: parsed.subject ?? null,
    headerFrom: displayAddress(parsed.from),
    headerTo: firstOf(parsed.to),
    date,
    messageId: parsed.messageId ? parsed.messageId.trim().replace(/^<|>$/g, "") : null,
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    attachments,
  };
}

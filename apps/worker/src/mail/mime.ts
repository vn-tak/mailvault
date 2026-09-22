/**
 * Rendering an outbound message into RFC 5322 bytes.
 *
 * Email Sending composes the wire copy itself (it assigns the final Message-ID and its own
 * MIME boundary), so this is *not* a transcript of what left the account. It is the record
 * the owner keeps: what was said, to whom, under which thread headers — enough to read the
 * message back months later or download it as `.eml`, which is what `raw_r2_key` is for on
 * received mail too.
 *
 * Bodies are always base64 so non-ASCII text needs no line-length or charset gymnastics,
 * and a composed message can never break the transport by containing a bare `--`.
 */

export interface OutboundRfc822 {
  /** Envelope + header From, the owner's alias address. */
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  /** Our own id for this message, so the stored copy is self-identifying. */
  messageId: string;
  date: Date;
  inReplyTo?: string | null;
  references?: string[];
  extraHeaders?: Record<string, string>;
}

const NEWLINE = "\r\n";

/** Base64 of UTF-8 bytes, chunked so a large body cannot blow the argument list. */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 76-char lines, as the MIME transfer-encoding rules ask for. */
function foldBase64(encoded: string): string {
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines.join(NEWLINE);
}

/** A header value that is not ASCII travels as one encoded-word (RFC 2047). */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  const b64 = base64Utf8(value).replace(/[\r\n]/g, "");
  // One encoded-word caps at 75 chars; long subjects split across several, space-separated.
  const budget = 52;
  const words: string[] = [];
  for (let i = 0; i < b64.length; i += budget) words.push(`=?UTF-8?B?${b64.slice(i, i + budget)}?=`);
  return words.join(NEWLINE + " ");
}

function displayAddress(address: string, name?: string): string {
  if (!name) return address;
  return `${encodeHeaderValue(name)} <${address}>`;
}

function addressList(addresses: string[] | undefined): string | null {
  return addresses && addresses.length > 0 ? addresses.join(", ") : null;
}

/** `<a@b>` form the reply headers require; ids are stored bare, so wrap on the way out. */
function angle(id: string): string {
  return id.startsWith("<") ? id : `<${id}>`;
}

export function buildOutboundMime(m: OutboundRfc822): string {
  const boundaryToken = `_mv_${m.messageId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
  const delim = `--${boundaryToken}`;
  const headers: (string | null)[] = [
    `From: ${displayAddress(m.from, m.fromName)}`,
    `To: ${addressList(m.to) ?? ""}`,
    m.cc && m.cc.length > 0 ? `Cc: ${addressList(m.cc)}` : null,
    m.replyTo ? `Reply-To: ${m.replyTo}` : null,
    `Subject: ${encodeHeaderValue(m.subject)}`,
    `Date: ${m.date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${angle(m.messageId)}`,
    m.inReplyTo ? `In-Reply-To: ${angle(m.inReplyTo)}` : null,
    m.references && m.references.length > 0
      ? `References: ${m.references.map(angle).join(" ")}`
      : null,
    "MIME-Version: 1.0",
    ...Object.entries(m.extraHeaders ?? {}).map(([k, v]) => `${k}: ${encodeHeaderValue(v)}`),
  ];

  const textPart = [
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(base64Utf8(m.text)),
  ];

  let body: string[];
  if (m.html) {
    const htmlPart = [
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(base64Utf8(m.html)),
    ];
    body = [
      `Content-Type: multipart/alternative; boundary="${boundaryToken}"`,
      "",
      delim,
      ...textPart,
      delim,
      ...htmlPart,
      `${delim}--`,
    ];
  } else {
    body = [...textPart];
  }

  const head = headers.filter((h): h is string => !!h).join(NEWLINE);
  // Bcc is deliberately absent: it is an envelope-only recipient and must not be written
  // into a record that is stored, downloaded and possibly forwarded later.
  return `${head}${NEWLINE}${NEWLINE}${body.join(NEWLINE)}${NEWLINE}`;
}

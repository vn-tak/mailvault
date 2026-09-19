/** Safe short text preview generated once at ingestion (section 45). Never derived
 *  from a full R2 read at render time. ~150–300 chars of normalized plain text. */

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPreview(text: string | null, html: string | null, max = 280): string | null {
  let base = text?.trim() ?? "";
  if (!base && html) base = stripHtmlToText(html);
  if (!base) return null;
  base = base.replace(/\s+/g, " ").trim();
  if (base.length <= max) return base;
  // Trim on a word boundary near the limit.
  const slice = base.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice) + "…";
}

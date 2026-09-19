/** Presentation-only formatting helpers. */

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fullTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Best-effort friendly sender name from "GitHub <noreply@github.com>". */
export function senderName(headerFrom: string | null | undefined, fallback: string): string {
  const src = headerFrom || fallback || "";
  const m = src.match(/^\s*"?([^"]*)"?\s*<([^>]+)>/);
  if (m) return m[1]?.trim() || m[2] || src;
  return src;
}

import { SendStatus } from "@mailvault/shared";
import { t } from "./i18n";

/** Presentation-only formatting helpers. */

/**
 * How far a delivery outcome has travelled, as a pill class.
 *
 * Only a refusal is red. `deferred` is amber because it is the one state that says "the
 * other server is still trying", which is the difference between a warning and an alarm.
 */
export function sendPill(status: SendStatus): string {
  if (status === SendStatus.Delivered) return "ok";
  if (status === SendStatus.Deferred || status === SendStatus.Complained) return "warn";
  if (status === SendStatus.Queued) return "muted";
  return "error";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t0 = new Date(iso).getTime();
  if (Number.isNaN(t0)) return "";
  const diff = Date.now() - t0;
  const s = Math.round(diff / 1000);
  if (s < 60) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("time.mAgo", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("time.hAgo", { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return t("time.dAgo", { n: d });
  return new Date(t0).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fullTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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

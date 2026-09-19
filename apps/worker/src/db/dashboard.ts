import type { DashboardStats } from "@mailvault/shared";
import { MailStatus } from "@mailvault/shared";
import { toMessageSummary } from "./mappers";
import type { MessageRow } from "./rows";

export async function getDashboardStats(db: D1Database, recentLimit = 8): Promise<DashboardStats> {
  const [domains, aliases, messages, unread, recent] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN mail_status = ?1 THEN 1 ELSE 0 END) AS ready
         FROM domains`,
      )
      .bind(MailStatus.Ready)
      .first<{ total: number; ready: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM aliases`).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM messages`).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE is_read = 0`).first<{ c: number }>(),
    db
      .prepare(
        `SELECT m.*, a.label AS alias_label, a.address AS alias_address, d.name AS domain_name
         FROM messages m
         LEFT JOIN aliases a ON a.id = m.alias_id
         LEFT JOIN domains d ON d.id = m.domain_id
         ORDER BY m.received_at DESC, m.id DESC LIMIT ?1`,
      )
      .bind(recentLimit)
      .all<MessageRow>(),
  ]);

  return {
    activeDomains: Number(domains?.ready ?? 0),
    totalDomains: Number(domains?.total ?? 0),
    totalAliases: Number(aliases?.c ?? 0),
    unreadMessages: Number(unread?.c ?? 0),
    totalMessages: Number(messages?.c ?? 0),
    recentMessages: (recent.results ?? []).map(toMessageSummary),
  };
}

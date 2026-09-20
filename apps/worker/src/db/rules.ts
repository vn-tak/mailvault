import type { Rule, RuleAction, RuleMatch } from "@mailvault/shared";
import { newId, nowIso } from "../lib/util";

export interface RuleRow {
  id: string;
  enabled: number;
  match_json: string;
  action_json: string;
  hits: number;
  last_hit_at: string | null;
  created_at: string;
}

/** A malformed row is skipped rather than thrown on: one bad rule must not break ingest. */
function toRule(row: RuleRow): Rule | null {
  try {
    return {
      id: row.id,
      enabled: row.enabled === 1,
      match: JSON.parse(row.match_json) as RuleMatch,
      action: JSON.parse(row.action_json) as RuleAction,
      hits: Number(row.hits ?? 0),
      lastHitAt: row.last_hit_at,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

const SELECT = `SELECT id, enabled, match_json, action_json, hits, last_hit_at, created_at FROM rules`;

export async function listRules(db: D1Database): Promise<Rule[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY created_at ASC`).all<RuleRow>();
  return (results ?? []).map(toRule).filter((r): r is Rule => !!r);
}

export async function listEnabledRules(db: D1Database): Promise<Rule[]> {
  const { results } = await db.prepare(`${SELECT} WHERE enabled = 1 ORDER BY created_at ASC`).all<RuleRow>();
  return (results ?? []).map(toRule).filter((r): r is Rule => !!r);
}

export async function getRule(db: D1Database, id: string): Promise<Rule | null> {
  const row = await db.prepare(`${SELECT} WHERE id = ?1`).bind(id).first<RuleRow>();
  return row ? toRule(row) : null;
}

export async function insertRule(db: D1Database, match: RuleMatch, action: RuleAction, enabled: boolean): Promise<Rule> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(`INSERT INTO rules (id, enabled, match_json, action_json, hits, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)`)
    .bind(id, enabled ? 1 : 0, JSON.stringify(match), JSON.stringify(action), now)
    .run();
  return { id, enabled, match, action, hits: 0, lastHitAt: null, createdAt: now };
}

export async function updateRule(
  db: D1Database,
  id: string,
  patch: { match?: RuleMatch; action?: RuleAction; enabled?: boolean },
): Promise<Rule | null> {
  const current = await getRule(db, id);
  if (!current) return null;
  const next: Rule = {
    ...current,
    match: patch.match ?? current.match,
    action: patch.action ?? current.action,
    enabled: patch.enabled ?? current.enabled,
  };
  await db
    .prepare(`UPDATE rules SET enabled = ?2, match_json = ?3, action_json = ?4 WHERE id = ?1`)
    .bind(id, next.enabled ? 1 : 0, JSON.stringify(next.match), JSON.stringify(next.action))
    .run();
  return next;
}

export async function deleteRule(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM rules WHERE id = ?1`).bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

/** One statement for the whole batch: a rule firing should cost one write, not N. */
export async function recordRuleHits(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = nowIso();
  await db.batch(ids.map((id) => db.prepare(`UPDATE rules SET hits = hits + 1, last_hit_at = ?2 WHERE id = ?1`).bind(id, now)));
}

/**
 * File one committed message. The note is written alongside so the archive explains
 * itself later, even after the rule that caused it has been changed or deleted.
 */
export async function fileByRule(
  db: D1Database,
  messageId: string,
  applied: { archive: boolean; tag: string | null; ruleId: string | null; note: string | null },
): Promise<void> {
  await db
    .prepare(`UPDATE messages SET archived = ?2, rule_tag = ?3, applied_rule_id = ?4, applied_rule_note = ?5 WHERE id = ?1`)
    .bind(messageId, applied.archive ? 1 : 0, applied.tag, applied.ruleId, applied.note)
    .run();
}

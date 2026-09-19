import type { Alias, AliasStatus } from "@mailvault/shared";
import { conflict } from "../lib/errors";
import { newId, nowIso } from "../lib/util";
import { toAlias } from "./mappers";
import type { AliasRow } from "./rows";

export interface NewAlias {
  domainId: string;
  domainName: string;
  localPart: string;
  label: string | null;
}

export async function createAlias(db: D1Database, input: NewAlias): Promise<Alias> {
  const address = `${input.localPart}@${input.domainName.toLowerCase()}`;
  const now = nowIso();
  const id = newId();
  try {
    await db
      .prepare(
        `INSERT INTO aliases (id, domain_id, local_part, address, label, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE', ?6, ?6)`,
      )
      .bind(id, input.domainId, input.localPart, address, input.label, now)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(msg)) {
      throw conflict("That alias already exists on this domain", { address });
    }
    throw err;
  }
  const created = await getAliasById(db, id);
  if (!created) throw new Error("alias insert did not persist");
  return created;
}

export async function getAliasById(db: D1Database, id: string): Promise<Alias | null> {
  const row = await db
    .prepare(
      `SELECT a.*, d.name AS domain_name,
        (SELECT COUNT(*) FROM messages m WHERE m.alias_id = a.id) AS message_count
       FROM aliases a JOIN domains d ON d.id = a.domain_id WHERE a.id = ?1`,
    )
    .bind(id)
    .first<AliasRow>();
  return row ? toAlias(row) : null;
}

export async function listAliases(db: D1Database, q?: string): Promise<Alias[]> {
  const like = q ? `%${q.toLowerCase().replace(/\s+/g, "%")}%` : null;
  const sql = `
    SELECT a.*, d.name AS domain_name,
      (SELECT COUNT(*) FROM messages m WHERE m.alias_id = a.id) AS message_count,
      (SELECT COUNT(*) FROM messages m WHERE m.alias_id = a.id AND m.is_read = 0) AS unread_count
    FROM aliases a JOIN domains d ON d.id = a.domain_id
    WHERE (?1 IS NULL OR lower(a.address) LIKE ?1 OR lower(COALESCE(a.label,'')) LIKE ?1)
    ORDER BY a.created_at DESC`;
  const { results } = await db.prepare(sql).bind(like).all<AliasRow>();
  return (results ?? []).map(toAlias);
}

/** Used by the inbound handler: only ACTIVE aliases receive mail. */
export async function findActiveAliasByAddress(
  db: D1Database,
  address: string,
): Promise<Alias | null> {
  const row = await db
    .prepare(`SELECT * FROM aliases WHERE address = ?1 AND status = 'ACTIVE'`)
    .bind(address.toLowerCase())
    .first<AliasRow>();
  return row ? toAlias(row) : null;
}

export async function aliasExists(
  db: D1Database,
  domainId: string,
  localPart: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS x FROM aliases WHERE domain_id = ?1 AND local_part = ?2`)
    .bind(domainId, localPart)
    .first<{ x: number }>();
  return !!row;
}

export async function setAliasStatus(
  db: D1Database,
  id: string,
  status: AliasStatus,
): Promise<void> {
  await db.prepare(`UPDATE aliases SET status = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, status, nowIso()).run();
}

export async function updateAliasLabel(db: D1Database, id: string, label: string | null): Promise<void> {
  await db.prepare(`UPDATE aliases SET label = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, label, nowIso()).run();
}

/** Returns the R2 keys that must be removed after the DB rows are deleted. */
export async function deleteAlias(
  db: D1Database,
  id: string,
  purgeMessages: boolean,
): Promise<{ rawKeys: string[] }> {
  if (!purgeMessages) {
    // messages.alias_id is ON DELETE SET NULL, so mail is preserved and stays
    // attributable via envelope_to. Only the alias mailbox itself is removed.
    await db.prepare(`DELETE FROM aliases WHERE id = ?1`).bind(id).run();
    return { rawKeys: [] };
  }
  const keys = await collectMessageR2KeysForAlias(db, id);
  await db.prepare(`DELETE FROM messages WHERE alias_id = ?1`).bind(id).run();
  await db.prepare(`DELETE FROM aliases WHERE id = ?1`).bind(id).run();
  return { rawKeys: keys };
}

export async function collectMessageR2KeysForAlias(db: D1Database, aliasId: string): Promise<string[]> {
  const msgs = await db
    .prepare(`SELECT raw_r2_key, parsed_r2_key FROM messages WHERE alias_id = ?1`)
    .bind(aliasId)
    .all<{ raw_r2_key: string; parsed_r2_key: string | null }>();
  const atts = await db
    .prepare(
      `SELECT r2_key FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE alias_id = ?1)`,
    )
    .bind(aliasId)
    .all<{ r2_key: string }>();
  const set = new Set<string>();
  for (const r of msgs.results ?? []) {
    set.add(r.raw_r2_key);
    if (r.parsed_r2_key) set.add(r.parsed_r2_key);
  }
  for (const a of atts.results ?? []) set.add(a.r2_key);
  return [...set];
}

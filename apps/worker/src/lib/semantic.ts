import type { Env } from "../env";
import { getSetting, setSetting } from "../db/settings";
import { log } from "./logging";

export const SEMANTIC_SETTING = "semanticSearch";
/** Enough of the body to match on meaning, short enough to stay cheap. */
export const EMBED_CHARS = 900;
/** Vectorize accepts up to 100 ids per delete call. */
const DELETE_BATCH = 100;

const MODEL = "@cf/baai/bge-m3";
const DIMENSIONS = 1024;

export interface SemanticFacts {
  subject: string | null;
  sender: string | null;
  body: string | null;
}

/**
 * The text that becomes a vector. Sender and subject lead because that is how people ask
 * ("the invoice from X", "the code from the bank"), and the body is truncated rather than
 * dropped — a long footer should not push the actual sentence out of the embedding.
 */
export function embedText(f: SemanticFacts): string {
  const head = [f.sender ?? "", f.subject ?? ""].filter(Boolean).join(" · ");
  const body = (f.body ?? "").replace(/\s+/g, " ").trim().slice(0, EMBED_CHARS);
  return `${head}\n${body}`.trim();
}

export async function semanticEnabled(db: D1Database): Promise<boolean> {
  return (await getSetting(db, SEMANTIC_SETTING)) === "on";
}

export async function setSemanticEnabled(db: D1Database, on: boolean): Promise<void> {
  await setSetting(db, SEMANTIC_SETTING, on ? "on" : "off");
}

function ready(env: Env): env is Env & { AI: NonNullable<Env["AI"]>; VECTORIZE: NonNullable<Env["VECTORIZE"]> } {
  return !!env.AI && !!env.VECTORIZE;
}

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI!.run(MODEL as never, { text: texts })) as unknown as { data?: number[][] };
  const vectors = res?.data ?? [];
  if (vectors.length !== texts.length) throw new Error("embedding count mismatch");
  return vectors;
}

/**
 * Index one message. Best-effort by design: if the model or the index is unavailable the
 * mail is still stored and searchable by keyword, and `embedded_at` stays null so the
 * status screen reports the gap honestly instead of pretending it is indexed.
 */
export async function indexMessage(env: Env, messageId: string, facts: SemanticFacts): Promise<boolean> {
  if (!ready(env)) return false;
  const text = embedText(facts);
  if (!text) return false;
  try {
    const [vector] = await embed(env, [text]);
    if (!vector) return false;
    await env.VECTORIZE!.upsert([{ id: messageId, values: vector, metadata: { indexedAt: new Date().toISOString() } }]);
    await env.DB.prepare(`UPDATE messages SET embedded_at = ?2 WHERE id = ?1`).bind(messageId, new Date().toISOString()).run();
    return true;
  } catch (err) {
    log.warn("semantic_index_failed", { error: err instanceof Error ? err.message : "error" });
    return false;
  }
}

export async function removeIndex(env: Env, messageId: string): Promise<void> {
  if (!ready(env)) return;
  try {
    await env.VECTORIZE!.deleteByIds([messageId]);
  } catch (err) {
    log.warn("semantic_unindex_failed", { error: err instanceof Error ? err.message : "error" });
  }
}

export async function searchMessageIds(env: Env, query: string, limit = 25): Promise<string[]> {
  if (!ready(env) || !query.trim()) return [];
  try {
    const [vector] = await embed(env, [query.trim()]);
    if (!vector) return [];
    const matches = await env.VECTORIZE!.query(vector, { topK: limit, returnMetadata: "none" });
    return (matches.matches ?? []).map((m) => String(m.id));
  } catch (err) {
    log.warn("semantic_search_failed", { error: err instanceof Error ? err.message : "error" });
    return [];
  }
}

export async function indexedCount(db: D1Database): Promise<{ indexed: number; total: number }> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(embedded_at IS NOT NULL), 0) AS indexed FROM messages`)
    .first<{ total: number; indexed: number }>();
  return { indexed: Number(row?.indexed ?? 0), total: Number(row?.total ?? 0) };
}

/** Everything currently indexed, so turning the feature off can remove exactly that. */
export async function indexedIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT id FROM messages WHERE embedded_at IS NOT NULL`).all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}

/**
 * Delete every vector and clear the markers. Called when the owner turns the feature off,
 * so "off" means the copies are gone rather than merely unused.
 */
export async function purgeIndex(env: Env): Promise<number> {
  if (!ready(env)) return 0;
  const ids = await indexedIds(env.DB);
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    await env.VECTORIZE!.deleteByIds(ids.slice(i, i + DELETE_BATCH));
  }
  await env.DB.prepare(`UPDATE messages SET embedded_at = NULL`).run();
  log.info("semantic_index_purged", { count: ids.length });
  return ids.length;
}

/**
 * Index one stored message by id, reading its own text back from R2. Used by the queue
 * consumer for new mail and by the backfill for mail that predates the setting, so both
 * go through the same path.
 */
export async function indexStoredMessage(env: Env, messageId: string): Promise<boolean> {
  if (!ready(env)) return false;
  const row = await env.DB
    .prepare(`SELECT subject, header_from, parsed_r2_key FROM messages WHERE id = ?1`)
    .bind(messageId)
    .first<{ subject: string | null; header_from: string | null; parsed_r2_key: string | null }>();
  if (!row?.parsed_r2_key) return false;
  const obj = await env.MAIL_BUCKET.get(row.parsed_r2_key);
  if (!obj) return false;
  const parsed = (await obj.json()) as { text?: string | null };
  return indexMessage(env, messageId, { subject: row.subject, sender: row.header_from, body: parsed.text ?? null });
}

/** Index a freshly committed message, if the owner turned this feature on. */
export async function indexIfEnabled(env: Env, messageId: string): Promise<void> {
  try {
    if (await semanticEnabled(env.DB)) await indexStoredMessage(env, messageId);
  } catch (err) {
    log.warn("semantic_index_failed", { error: err instanceof Error ? err.message : "error" });
  }
}

/** Index up to `batch` messages that were stored before the feature was turned on. */
export async function backfill(env: Env, batch = 50): Promise<{ indexed: number; remaining: number }> {
  if (!ready(env)) return { indexed: 0, remaining: 0 };
  const { results } = await env.DB
    .prepare(`SELECT id FROM messages WHERE embedded_at IS NULL ORDER BY received_at DESC LIMIT ?1`)
    .bind(batch)
    .all<{ id: string }>();

  let indexed = 0;
  for (const row of results ?? []) {
    if (await indexStoredMessage(env, row.id)) indexed += 1;
  }
  const counts = await indexedCount(env.DB);
  return { indexed, remaining: Math.max(0, counts.total - counts.indexed) };
}

export const EMBEDDING_MODEL = MODEL;
export const EMBEDDING_DIMENSIONS = DIMENSIONS;

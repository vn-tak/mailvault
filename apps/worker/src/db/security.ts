import type { Passkey } from "@mailvault/shared";
import { newId, nowIso, randomToken, sha256Hex } from "../lib/util";

/** A stored passkey. `publicKey` never leaves this module — see `toPublic`. */
export interface StoredPasskey {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PasskeyRow {
  id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
}

function toStored(r: PasskeyRow): StoredPasskey {
  let transports: string[] | null = null;
  if (r.transports) {
    try {
      const parsed: unknown = JSON.parse(r.transports);
      if (Array.isArray(parsed)) transports = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      /* stored value was not JSON; treat it as unknown */
    }
  }
  return {
    id: r.id,
    credentialId: r.credential_id,
    publicKey: r.public_key,
    counter: Number(r.counter ?? 0),
    transports,
    deviceLabel: r.device_label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

/** What an API may return: which device, and when. Not the verifier. */
export function toPublic(p: StoredPasskey): Passkey {
  return {
    id: p.id,
    deviceLabel: p.deviceLabel,
    transports: p.transports,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  };
}

const SELECT_ALL = `SELECT id, credential_id, public_key, counter, transports, device_label, created_at, last_used_at FROM passkeys ORDER BY created_at ASC`;

export async function listPasskeys(db: D1Database): Promise<StoredPasskey[]> {
  const { results } = await db.prepare(SELECT_ALL).all<PasskeyRow>();
  return (results ?? []).map(toStored);
}

export async function findPasskeyByCredential(db: D1Database, credentialId: string): Promise<StoredPasskey | null> {
  const row = await db
    .prepare(
      `SELECT id, credential_id, public_key, counter, transports, device_label, created_at, last_used_at
       FROM passkeys WHERE credential_id = ?1`,
    )
    .bind(credentialId)
    .first<PasskeyRow>();
  return row ? toStored(row) : null;
}

export async function addPasskey(
  db: D1Database,
  input: { credentialId: string; publicKey: string; counter: number; transports: string[] | null; deviceLabel: string | null },
): Promise<StoredPasskey> {
  const now = nowIso();
  const id = newId();
  await db
    .prepare(
      `INSERT INTO passkeys (id, credential_id, public_key, counter, transports, device_label, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(id, input.credentialId, input.publicKey, input.counter, JSON.stringify(input.transports ?? []), input.deviceLabel, now)
    .run();
  return {
    id,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    counter: input.counter,
    transports: input.transports,
    deviceLabel: input.deviceLabel,
    createdAt: now,
    lastUsedAt: null,
  };
}

export async function removePasskey(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM passkeys WHERE id = ?1`).bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function touchPasskey(db: D1Database, id: string, counter: number): Promise<void> {
  await db
    .prepare(`UPDATE passkeys SET counter = ?2, last_used_at = ?3 WHERE id = ?1`)
    .bind(id, counter, nowIso())
    .run();
}

/**
 * Challenges and grants are single-purpose and minutes old, so expired rows are cleared
 * inline whenever a new one is written. There is no cron that deletes anything here —
 * that policy is about mail (SECURITY.md §10), and these are not mail.
 */
export async function newChallenge(db: D1Database, kind: "register" | "assert", ttlMs: number): Promise<string> {
  const now = Date.now();
  const challenge = randomToken();
  await db.batch([
    db.prepare(`DELETE FROM webauthn_challenges WHERE expires_at <= ?1`).bind(new Date(now).toISOString()),
    db
      .prepare(`INSERT INTO webauthn_challenges (id, kind, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`)
      .bind(challenge, kind, new Date(now).toISOString(), new Date(now + ttlMs).toISOString()),
  ]);
  return challenge;
}

/** True only for a challenge that exists, matches `kind`, and has not expired. Consumed. */
export async function consumeChallenge(db: D1Database, challenge: string, kind: "register" | "assert"): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM webauthn_challenges WHERE id = ?1 AND kind = ?2 AND expires_at > ?3`)
    .bind(challenge, kind, nowIso())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export interface Grant {
  token: string;
  expiresAt: string;
}

export async function newGrant(db: D1Database, ttlMs: number): Promise<Grant> {
  const now = Date.now();
  const token = randomToken();
  const expiresAt = new Date(now + ttlMs).toISOString();
  await db.batch([
    db.prepare(`DELETE FROM step_up_grants WHERE expires_at <= ?1`).bind(new Date(now).toISOString()),
    db
      .prepare(`INSERT INTO step_up_grants (token_hash, created_at, expires_at) VALUES (?1, ?2, ?3)`)
      .bind(await sha256Hex(token), new Date(now).toISOString(), expiresAt),
  ]);
  return { token, expiresAt };
}

/** Only the hash is looked up, so a read of this table cannot mint someone's unlock. */
export async function grantIsValid(db: D1Database, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await db
    .prepare(`SELECT 1 AS ok FROM step_up_grants WHERE token_hash = ?1 AND expires_at > ?2`)
    .bind(await sha256Hex(token), nowIso())
    .first<{ ok: number }>();
  return !!row;
}

export async function revokeGrants(db: D1Database): Promise<void> {
  await db.prepare(`DELETE FROM step_up_grants`).run();
}

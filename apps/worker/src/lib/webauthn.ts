import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Env } from "../env";
import { appOrigin } from "../env";
import type { StoredPasskey } from "../db/security";
import { base64UrlToBytes, bytesToBase64Url } from "./util";
import { log } from "./logging";

/** A challenge is worth about as much as the user's patience with the prompt. */
export const CHALLENGE_TTL_MS = 60_000;
/** How long one unlock stays valid for the operations behind it. */
export const GRANT_TTL_MS = 5 * 60_000;

export interface Rp {
  rpName: string;
  rpID: string;
  origin: string;
}

/**
 * The relying-party identity comes from the configured app origin, never from the request
 * host. A passkey is bound to its RP by spec, so honouring whatever host arrived would let
 * a credential minted for one hostname be offered on another.
 */
export function rpFor(env: Env): Rp | null {
  const configured = appOrigin(env);
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return { rpName: "MailVault", rpID: url.hostname, origin: url.origin };
  } catch {
    return null;
  }
}

export type Verified<T> = ({ ok: true } & T) | { ok: false; reason: string };

export function registrationOptions(rp: Rp, userName: string, exclude: StoredPasskey[]): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName,
    userDisplayName: userName,
    // `required` is the point of this feature: the unlock must be the owner's fingerprint,
    // passcode or security key, not merely a device that happens to be present.
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    excludeCredentials: exclude.map((p) => ({ id: p.credentialId, type: "public-key" as const })),
  });
}

export function assertionOptions(rp: Rp, allow: StoredPasskey[]): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required",
    allowCredentials: allow.map((p) => ({ id: p.credentialId, type: "public-key" as const, transports: p.transports ?? undefined })),
  });
}

export interface NewCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
}

export async function verifyRegistration(
  rp: Rp,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<Verified<NewCredential>> {
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo) return { ok: false, reason: "The passkey could not be verified" };
    const c = result.registrationInfo.credential;
    return {
      ok: true,
      credentialId: c.id,
      publicKey: bytesToBase64Url(c.publicKey),
      counter: c.counter,
      transports: c.transports ?? null,
    };
  } catch (err) {
    log.warn("passkey_registration_failed", { error: err instanceof Error ? err.message : "error" });
    return { ok: false, reason: "The passkey could not be verified" };
  }
}

export async function verifyAssertion(
  rp: Rp,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: StoredPasskey,
): Promise<Verified<{ newCounter: number }>> {
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: base64UrlToBytes(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports ?? undefined,
      },
    });
    if (!result.verified) return { ok: false, reason: "Signature verification failed" };
    return { ok: true, newCounter: result.authenticationInfo.newCounter };
  } catch (err) {
    log.warn("passkey_assertion_failed", { error: err instanceof Error ? err.message : "error" });
    return { ok: false, reason: "Signature verification failed" };
  }
}

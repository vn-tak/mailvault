/**
 * The step-up grant, kept in memory only.
 *
 * It is a bearer token for a few minutes, so putting it in localStorage would hand a
 * stolen-session attacker the second factor they are meant to stop. Losing it on reload is
 * the point: the next irreversible action asks for the passkey again.
 */
export const STEP_UP_HEADER = "x-mailvault-stepup";

let token: string | null = null;
let expiresAt = 0;

export function rememberGrant(next: string, expires: string): void {
  const at = Date.parse(expires);
  if (!next || Number.isNaN(at)) return;
  token = next;
  expiresAt = at;
}

export function clearGrant(): void {
  token = null;
  expiresAt = 0;
}

/** Headers for a mutation, carrying the grant when there is one left to carry. */
export function grantHeaders(): Record<string, string> {
  if (token && Date.now() < expiresAt) return { [STEP_UP_HEADER]: token };
  if (token) clearGrant();
  return {};
}

export function secondsLeft(now = Date.now()): number {
  if (!token) return 0;
  return Math.max(0, Math.round((expiresAt - now) / 1000));
}

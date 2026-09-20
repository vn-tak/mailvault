import type {
  AddressReuse,
  Alias,
  AliasDetail,
  AuthPolicy,
  CreateAliasInput,
  DashboardStats,
  Domain,
  DriftReport,
  Health,
  MessageDetail,
  MessageListQuery,
  Paginated,
  Passkey,
  PreflightResult,
  ProvisionOutcome,
  PushOutcome,
  MessageSummary,
  Rule,
  RuleAction,
  RuleMatch,
  UpdateAliasInput,
} from "@mailvault/shared";
import { grantHeaders } from "./grant";

/**
 * WebAuthn option objects as they travel over the wire. The browser types for them are
 * tied to `BufferSource`, which is not what JSON carries, so they stay loose here and the
 * WebAuthn library does the conversion at the boundary.
 */
export interface PasskeyOptions {
  options: unknown;
  challenge: string;
}

export interface StepUpOptions {
  options: unknown;
  challenge: string;
}

export interface SecurityStatus {
  passkeys: Passkey[];
  enrolled: boolean;
  rpId: string | null;
}

const BASE = "/api";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON (shouldn't happen); fall through to error below */
    }
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiClientError(res.status, err?.code ?? "ERROR", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

// The Worker requires this custom header on state-changing calls as a CSRF signal, and
// looks for the step-up grant on the ones that cannot be undone.
function mutation(body?: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", "x-mailvault": "1", ...grantHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  health: () => request<Health>("/health"),
  dashboard: () => request<DashboardStats>("/dashboard"),

  listDomains: () => request<{ items: Domain[] }>("/domains"),
  syncDomains: () => request<{ discovered: number; items: Domain[] }>("/domains/sync", mutation()),
  verifyDomains: () => request<{ report: DriftReport; items: Domain[] }>("/domains/verify", mutation()),
  preflightDomains: (zoneIds: string[]) =>
    request<{ results: PreflightResult[] }>("/domains/preflight", mutation({ zoneIds })),
  /** Both takeover flags are explicit, per-request confirmations of a destructive change. */
  provisionDomains: (
    zoneIds: string[],
    flags: { allowCatchAllTakeover?: boolean; allowMxTakeover?: boolean } = {},
  ) =>
    request<{ results: ProvisionOutcome[] }>("/domains/provision", mutation({
      zoneIds,
      allowCatchAllTakeover: flags.allowCatchAllTakeover ?? false,
      allowMxTakeover: flags.allowMxTakeover ?? false,
    })),
  retryDomain: (zoneId: string, allowCatchAllTakeover = false) =>
    request<ProvisionOutcome>(`/domains/${encodeURIComponent(zoneId)}/retry`, mutation({ allowCatchAllTakeover })),
  removeDomain: (zoneId: string) =>
    request<{ removed: boolean }>(`/domains/${encodeURIComponent(zoneId)}`, mutation(undefined, "DELETE")),
  setAuthPolicy: (zoneId: string, policy: AuthPolicy) =>
    request<{ zoneId: string; authPolicy: AuthPolicy }>(
      `/domains/${encodeURIComponent(zoneId)}/auth-policy`,
      mutation({ policy }, "PATCH"),
    ),

  listAliases: (q?: string, view: "all" | "active" | "archived" = "active") =>
    request<{ items: Alias[] }>(`/aliases${qs({ q, view })}`),
  getAlias: (id: string) => request<AliasDetail>(`/aliases/${encodeURIComponent(id)}`),
  updateAlias: (id: string, patch: UpdateAliasInput) =>
    request<Alias>(`/aliases/${encodeURIComponent(id)}`, mutation(patch, "PATCH")),
  createAlias: (input: CreateAliasInput) => request<Alias>("/aliases", mutation(input)),
  enableAlias: (id: string) => request<Alias>(`/aliases/${encodeURIComponent(id)}/enable`, mutation()),
  disableAlias: (id: string) => request<Alias>(`/aliases/${encodeURIComponent(id)}/disable`, mutation()),
  deleteAlias: (id: string, purgeMessages: boolean) =>
    request<{ deleted: boolean }>(`/aliases/${encodeURIComponent(id)}`, mutation({ purgeMessages }, "DELETE")),

  listMessages: (query: Partial<MessageListQuery>) =>
    request<Paginated<MessageSummary>>(`/messages${qs({ ...query })}`),
  getMessage: (id: string, remoteImages = false) =>
    request<MessageDetail>(`/messages/${encodeURIComponent(id)}${qs({ remoteImages: remoteImages ? "1" : "" })}`),
  setMessageRead: (id: string, isRead: boolean) =>
    request<{ id: string; isRead: boolean }>(`/messages/${encodeURIComponent(id)}/read`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-mailvault": "1" },
      body: JSON.stringify({ isRead }),
    }),
  deleteMessage: (id: string) =>
    request<{ deleted: boolean }>(`/messages/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-mailvault": "1" },
    }),

  pushPublicKey: () => request<{ key: string | null }>("/push/public-key"),
  pushStatus: () => request<{ enabled: boolean; subscriptions: number }>("/push/status"),
  pushSubscribe: (input: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) =>
    request<{ id: string }>("/push/subscribe", mutation(input)),
  pushUnsubscribe: (endpoint: string) => request<{ removed: number }>("/push/unsubscribe", mutation({ endpoint })),
  pushTest: () => request<PushOutcome>("/push/test", mutation()),

  securityStatus: () => request<SecurityStatus>("/security/status"),
  passkeyOptions: () => request<PasskeyOptions>("/security/passkeys/options", mutation()),
  passkeyVerify: (input: { response: unknown; challenge: string; deviceLabel?: string }) =>
    request<{ passkey: Passkey }>("/security/passkeys/verify", mutation(input)),
  deletePasskey: (id: string) =>
    request<{ removed: boolean }>(`/security/passkeys/${encodeURIComponent(id)}`, mutation(undefined, "DELETE")),
  stepUpOptions: () => request<StepUpOptions>("/security/step-up/options", mutation()),
  stepUpVerify: (input: { response: unknown; challenge: string }) =>
    request<{ token: string; expiresAt: string; seconds: number }>("/security/step-up/verify", mutation(input)),

  listRules: () => request<{ items: Rule[] }>("/rules"),
  createRule: (input: { match: RuleMatch; action: RuleAction; enabled?: boolean }) =>
    request<Rule>("/rules", mutation(input)),
  updateRule: (id: string, patch: { match?: RuleMatch; action?: RuleAction; enabled?: boolean }) =>
    request<Rule>(`/rules/${encodeURIComponent(id)}`, mutation(patch, "PATCH")),
  deleteRule: (id: string) => request<{ removed: boolean }>(`/rules/${encodeURIComponent(id)}`, mutation(undefined, "DELETE")),
  addressReuse: () => request<{ items: AddressReuse[] }>("/report/address-reuse"),

  semanticStatus: () => request<SemanticStatus>("/semantic"),
  semanticSet: (enabled: boolean) =>
    request<{ enabled: boolean; indexed: number; total: number; purged: number }>("/semantic", mutation({ enabled })),
  semanticBackfill: () => request<{ indexed: number; remaining: number }>("/semantic/backfill", mutation()),
};

export interface SemanticStatus {
  enabled: boolean;
  indexed: number;
  total: number;
  model: string;
  dimensions: number;
  available: boolean;
}

/** Authenticated, same-origin download URL for an attachment (never a public URL). */
export function attachmentHref(messageId: string, attachmentId: string): string {
  return `${BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

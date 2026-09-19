import type {
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
  PreflightResult,
  ProvisionOutcome,
  MessageSummary,
  UpdateAliasInput,
} from "@mailvault/shared";

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

// The Worker requires this custom header on state-changing calls as a CSRF signal.
function mutation(body?: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", "x-mailvault": "1" },
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
  provisionDomains: (zoneIds: string[], allowCatchAllTakeover = false) =>
    request<{ results: ProvisionOutcome[] }>("/domains/provision", mutation({ zoneIds, allowCatchAllTakeover })),
  retryDomain: (zoneId: string, allowCatchAllTakeover = false) =>
    request<ProvisionOutcome>(`/domains/${encodeURIComponent(zoneId)}/retry`, mutation({ allowCatchAllTakeover })),
  removeDomain: (zoneId: string) =>
    request<{ removed: boolean }>(`/domains/${encodeURIComponent(zoneId)}`, {
      method: "DELETE",
      headers: { "x-mailvault": "1" },
    }),
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
    request<{ deleted: boolean }>(`/aliases/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-mailvault": "1" },
      body: JSON.stringify({ purgeMessages }),
    }),

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
};

/** Authenticated, same-origin download URL for an attachment (never a public URL). */
export function attachmentHref(messageId: string, attachmentId: string): string {
  return `${BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

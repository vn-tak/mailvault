import { describe, expect, it } from "vitest";
import { CatchAllStatus, ConflictType, MailStatus, RoutingStatus } from "@mailvault/shared";
import { CloudflareApiError, type CloudflareClient } from "../../src/cf/api-client";
import type { DomainRow } from "../../src/db/rows";
import { provisionDomain } from "../../src/provisioning/provisioner";

const row: DomainRow = {
  id: "d1",
  cloudflare_zone_id: "z1",
  cloudflare_account_id: null,
  name: "example.com",
  zone_status: "active",
  zone_type: "full",
  mail_status: MailStatus.Discovered,
  routing_status: RoutingStatus.Unknown,
  catch_all_status: CatchAllStatus.Unknown,
  conflict_type: ConflictType.None,
  conflict_details_json: null,
  last_checked_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function stubDb() {
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      const isSelect = /^\s*SELECT/i.test(sql);
      const api: Record<string, unknown> = {
        bind: () => api,
        first: async () => (isSelect ? row : null),
        all: async () => [],
        run: async () => {
          writes.push(sql.trim().slice(0, 48));
          return { success: true, meta: {} };
        },
      };
      return api;
    },
    batch: async () => [],
  };
  return { db: db as unknown as D1Database, writes };
}

function stubClient(
  overrides: Partial<
    Record<"listDnsRecords" | "getEmailRoutingStatus" | "enableEmailRouting", () => Promise<unknown>>
  > = {},
) {
  const mutations: string[] = [];
  const client = {
    hasToken: true,
    listAllZones: async () => [],
    listDnsRecords: async () => (overrides.listDnsRecords ? ((await overrides.listDnsRecords()) as never) : []),
    getEmailRoutingStatus: async () =>
      overrides.getEmailRoutingStatus ? ((await overrides.getEmailRoutingStatus()) as never) : {},
    getEmailRoutingDns: async () => [],
    enableEmailRouting: async () => {
      if (overrides.enableEmailRouting) {
        await overrides.enableEmailRouting();
        return;
      }
      mutations.push("enableEmailRouting");
    },
    getCatchAll: async () => null,
    setCatchAllWorker: async () => {
      mutations.push("setCatchAllWorker");
    },
  } as unknown as CloudflareClient;
  return { client, mutations };
}

const deniedRead = () => {
  throw new CloudflareApiError("permission", "Cloudflare API error: Authentication error", 403, [10000]);
};

describe("provisionDomain allow-list gate (section 7/9)", () => {
  it("refuses to mutate when the MX read is denied by Cloudflare", async () => {
    const { client, mutations } = stubClient({ listDnsRecords: deniedRead });
    const { db, writes } = stubDb();

    const out = await provisionDomain(db, client, "z1", "mail-vault", {});

    expect(mutations).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("API_PERMISSION_ERROR");
    // It must still have recorded the local outcome for the audit trail.
    expect(writes.length).toBeGreaterThan(0);
  });

  it("refuses to mutate over a third-party MX even when takeover is requested", async () => {
    const { client, mutations } = stubClient({
      listDnsRecords: async () => [{ content: "aspmx.l.google.com", priority: 1 }],
    });
    const { db } = stubDb();

    const out = await provisionDomain(db, client, "z1", "mail-vault", { allowCatchAllTakeover: true });

    expect(mutations).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(MailStatus.Conflict);
  });

  it("proceeds when only the routing settings flag is unreadable and MX is clean", async () => {
    const { client, mutations } = stubClient({ getEmailRoutingStatus: deniedRead });
    const { db } = stubDb();

    const out = await provisionDomain(db, client, "z1", "mail-vault", {});

    // The routing flag is not a safety signal; foreign MX and foreign catch-all are.
    expect(mutations).toContain("enableEmailRouting");
    expect(out.ok).toBe(false); // verification still refuses to claim READY blindly
  });

  it("does not re-enable routing when Cloudflare MX already exist", async () => {
    const { client, mutations } = stubClient({
      listDnsRecords: async () => [{ content: "route1.mx.cloudflare.net", priority: 36 }],
    });
    const { db } = stubDb();

    const out = await provisionDomain(db, client, "z1", "mail-vault", {});

    expect(mutations).not.toContain("enableEmailRouting");
    expect(mutations).toContain("setCatchAllWorker");
    expect(out.steps.map((s) => s.step)).toContain("email_routing_dns");
  });

  it("tells the owner what to do when only the dashboard can enable routing", async () => {
    const { client } = stubClient({
      enableEmailRouting: async () => {
        throw new CloudflareApiError(
          "permission",
          "Cloudflare API error: Authentication error",
          403,
          [10000],
          "/zones/z1/email/routing/enable",
        );
      },
    });
    const { db } = stubDb();

    const out = await provisionDomain(db, client, "z1", "mail-vault", {});

    expect(out.ok).toBe(false);
    expect(out.error).toContain("Enable Email Routing once");
    expect(out.error).toContain("click Retry");
    expect(out.error).not.toContain("Authentication error");
  });

  it("proceeds for a clean zone", async () => {
    const { client, mutations } = stubClient();
    const { db } = stubDb();

    const out = await provisionDomain(db, client, "z1", "mail-vault", {});

    expect(mutations).toContain("enableEmailRouting");
    expect(mutations).toContain("setCatchAllWorker");
    // Verification re-reads routing state; the stub reports it as not-ready, so the
    // domain must NOT be marked READY off a single successful write.
    expect(out.status).toBe(MailStatus.Failed);
    expect(out.ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createCloudflareClient } from "../../src/cf/api-client";

interface Sent {
  url: string;
  method?: string;
  body: unknown;
  headers: Record<string, string>;
}

function recordingFetch(sent: Sent[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      method: init?.method,
      body: init?.body ?? null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const TOKEN = "test-token-value";
const ZONE = "92537bc48261d3b53ab25eaa4cab2c90";

describe("Cloudflare client request shapes", () => {
  it("enables Email Routing via the token-authorized endpoint with an empty body", async () => {
    const sent: Sent[] = [];
    const client = createCloudflareClient({ token: TOKEN, fetch: recordingFetch(sent) });

    await client.enableEmailRouting(ZONE);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
    // /email/routing/dns answers 403 for API tokens; /enable is the token path.
    expect(sent[0]!.url).toBe(`https://api.cloudflare.com/client/v4/zones/${ZONE}/email/routing/enable`);
    // A zone-apex `name` here fails with CF 2007, so the body carries no domain.
    expect(JSON.parse(String(sent[0]!.body))).toEqual({});
  });

  it("points the catch-all at our worker", async () => {
    const sent: Sent[] = [];
    const client = createCloudflareClient({ token: TOKEN, fetch: recordingFetch(sent) });

    await client.setCatchAllWorker(ZONE, "mail-vault");

    expect(sent[0]!.method).toBe("PUT");
    expect(sent[0]!.url).toContain(`/zones/${ZONE}/email/routing/rules/catch_all`);
    expect(JSON.parse(String(sent[0]!.body))).toMatchObject({
      actions: [{ type: "worker", value: ["mail-vault"] }],
      matchers: [{ type: "all" }],
      enabled: true,
    });
  });

  it("authenticates by header only — the token never appears in the URL", async () => {
    const sent: Sent[] = [];
    const client = createCloudflareClient({ token: TOKEN, accountId: "acct1", fetch: recordingFetch(sent) });

    await client.listAllZones();
    await client.listDnsRecords(ZONE, "MX");

    for (const s of sent) {
      expect(s.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(s.url).not.toContain(TOKEN);
    }
    expect(sent[0]!.url).toContain("account.id=acct1");
    expect(sent[1]!.url).toContain("type=MX");
  });
});

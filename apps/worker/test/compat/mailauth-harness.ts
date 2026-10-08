// Test-only Worker. It calls the installed mailauth package, with the pnpm patch applied,
// inside workerd, so the compatibility claim covers the real dependency rather than a copy.
// The policy is fixed here: strict parsing, and RSA-SHA1 is refused with a `policy` result.
// `/evidence` runs the production verifier (src/mail/dkim.ts) over the same bytes, so the path
// that can produce TRUSTED is exercised inside workerd as well.
import { dkimVerify } from "mailauth/lib/dkim/verify";
import { verifyDkim } from "../../src/mail/dkim";

interface VerifyRequest {
  message: string;
  dns: Record<string, string[][]>;
}

function txtFrom(dns: Record<string, string[][]>) {
  return async (name: string) => {
    const record = dns[name];
    if (record) return record;
    throw Object.assign(new Error(`no TXT record for ${name}`), { code: "ENOTFOUND" });
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") return Response.json({ ready: true });

    const { message, dns } = (await request.json()) as VerifyRequest;
    if (new URL(request.url).pathname === "/evidence") {
      const evidence = await verifyDkim(new TextEncoder().encode(message), {
        resolveTxt: txtFrom(dns),
      });
      return Response.json({ evidence });
    }

    const resolver = async (name: string, type: string) => {
      const record = dns[name];
      if (type === "TXT" && record) return record;
      throw Object.assign(new Error(`no ${type} record for ${name}`), { code: "ENOTFOUND" });
    };

    const verified = await dkimVerify(message, { strict: true, rejectRsaSha1: true, resolver });
    return Response.json({
      results: verified.results.map((r) => ({
        result: r.status.result,
        comment: r.status.comment ?? null,
        algorithm: r.algo ?? null,
      })),
    });
  },
};

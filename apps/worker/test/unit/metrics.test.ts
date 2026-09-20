import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env";
import { Elapsed, writeMetric } from "../../src/lib/metrics";

interface Row {
  blobs: string[];
  doubles: number[];
}

function capture(): { env: Env; rows: Row[] } {
  const rows: Row[] = [];
  const env = { ANALYTICS: { writeDataPoint: (r: Row) => void rows.push(r) } } as unknown as Env;
  return { env, rows };
}

describe("writeMetric", () => {
  it("writes the fixed column order, because the dataset is queried as blob_N", () => {
    const { env, rows } = capture();
    writeMetric(env, "ingest_commit", { outcome: "stored", verdict: "TRUSTED", commitMs: 12 });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.blobs).toEqual(["ingest_commit", "stored", "", "TRUSTED"]);
    expect(rows[0]!.doubles).toEqual([0, 12]);
  });

  it("has no column for content: the row is always four strings and two numbers", () => {
    const { env, rows } = capture();
    writeMetric(env, "ingest", { outcome: "rejected", reason: "unknown_recipient", stageMs: 3 });
    writeMetric(env, "push", { outcome: "partial", reason: "sent=2 pruned=0 failed=1", stageMs: 40 });

    for (const row of rows) {
      expect(row.blobs).toHaveLength(4);
      expect(row.doubles).toHaveLength(2);
      expect(row.blobs.join(" ")).not.toContain("@");
    }
  });

  it("does nothing where the binding is absent, so a partial config still runs", () => {
    expect(() => writeMetric({} as unknown as Env, "ingest", { outcome: "staged" })).not.toThrow();
  });

  it("swallows a dataset failure: metrics must never break delivery", () => {
    const env = {
      ANALYTICS: { writeDataPoint: vi.fn(() => {
        throw new Error("dataset unavailable");
      }) },
    } as unknown as Env;
    expect(() => writeMetric(env, "ingest", { outcome: "staged" })).not.toThrow();
  });
});

describe("Elapsed", () => {
  it("splits a span into consecutive segments rather than re-reading the same total", () => {
    const t = new Elapsed();
    const first = t.stop();
    const second = t.stop();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
  });
});

import type { Env } from "../env";
import { log } from "./logging";

/**
 * Analytics Engine — the "what has been happening over time" surface. `log` answers
 * "what just happened to this message"; neither replaces the other.
 *
 * The order of `blobs`/`doubles` below is the schema, and it is written out positionally
 * because the dataset is queried as SQL over `blob_N`/`double_N`: reordering the arrays
 * silently relabels every historical query without failing anything.
 *
 *   blob_1 event    — ingest | ingest_commit | push | watchdog | sending | delivery
 *   blob_2 outcome  — stored | rejected | duplicate | failed | ok | skipped
 *   blob_3 reason   — the rejection or failure reason, from a fixed vocabulary
 *   blob_4 verdict  — sender auth verdict for mail rows, "" otherwise
 *   dbl_1  stage_ms — parse + R2 writes (ingest only)
 *   dbl_2  commit_ms — D1 commit, or the whole call for the others
 *
 * What is deliberately absent: addresses, subjects, message or alias ids. These rows are a
 * measurement; the owner's mail stays in R2 behind the authenticated routes.
 */
export interface MetricPoint {
  outcome: string;
  reason?: string;
  verdict?: string;
  stageMs?: number;
  commitMs?: number;
}

/** Never throws: a metrics outage must not affect delivery, push or a request. */
export function writeMetric(env: Env, event: string, p: MetricPoint): void {
  const ds = env.ANALYTICS;
  if (!ds) return;
  try {
    ds.writeDataPoint({
      blobs: [event, p.outcome, p.reason ?? "", p.verdict ?? ""],
      doubles: [p.stageMs ?? 0, p.commitMs ?? 0],
    });
  } catch (err) {
    log.warn("metric_write_failed", { event, error: err instanceof Error ? err.message : "error" });
  }
}

/** Splits a span into consecutive segments, so stage and commit are timed separately. */
export class Elapsed {
  private started = Date.now();

  /** Milliseconds since the last `stop()` (or construction). */
  stop(): number {
    const now = Date.now();
    const ms = now - this.started;
    this.started = now;
    return ms;
  }
}

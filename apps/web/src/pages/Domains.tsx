import { useMemo, useState } from "react";
import { api, ApiClientError } from "../lib/api";
import { navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime } from "../lib/format";
import { ConfirmDialog, ErrorBanner, Loading, Modal, StatusPill } from "../components/ui";
import {
  ConflictType,
  MailStatus,
  PreflightClassification,
  type Domain,
  type PreflightResult,
  type ProvisionOutcome,
} from "@mailvault/shared";

const CLASS_PILL: Record<string, { cls: string; text: string }> = {
  [PreflightClassification.ReadyToProvision]: { cls: "ready", text: "Ready to enable" },
  [PreflightClassification.AlreadyConfigured]: { cls: "accent", text: "Already configured" },
  [PreflightClassification.MxConflict]: { cls: "conflict", text: "MX conflict" },
  [PreflightClassification.CatchAllConflict]: { cls: "conflict", text: "Catch-all conflict" },
  [PreflightClassification.ZoneInactive]: { cls: "error", text: "Zone inactive" },
  [PreflightClassification.UnsupportedZone]: { cls: "error", text: "Unsupported zone" },
  [PreflightClassification.ApiPermissionError]: { cls: "error", text: "Permission error" },
  [PreflightClassification.ProvisioningError]: { cls: "error", text: "Provisioning error" },
};

function ClassPill({ c }: { c: string }) {
  const s = CLASS_PILL[c] ?? { cls: "neutral", text: c };
  return <span className={`pill ${s.cls}`}>{s.text}</span>;
}

function ConflictBox({ result }: { result: PreflightResult }) {
  const cf = result.conflict;
  if (!cf) return null;
  return (
    <div className="banner error" style={{ marginTop: 8, marginBottom: 0 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{cf.message}</div>
      {cf.type === ConflictType.Mx && cf.mxRecords && cf.mxRecords.length > 0 && (
        <ul className="mono" style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>
          {cf.mxRecords.map((r, i) => (
            <li key={i}>
              {r.priority} {r.exchange}
            </li>
          ))}
        </ul>
      )}
      {cf.type === ConflictType.CatchAll && cf.catchAll?.destination && (
        <div className="mono" style={{ fontSize: 12 }}>
          Currently routed to: {cf.catchAll.actionType ?? "worker"} → {cf.catchAll.destination}
        </div>
      )}
    </div>
  );
}

function OutcomeBox({ o }: { o: ProvisionOutcome }) {
  return (
    <div className={`banner ${o.ok ? "ok" : "error"}`} style={{ marginTop: 8, marginBottom: 0 }}>
      <div style={{ fontWeight: 600 }}>
        {o.ok ? "Mail enabled" : "Provisioning failed"}
        {o.error ? ` — ${o.error}` : ""}
      </div>
      {o.steps.length > 0 && (
        <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>
          {o.steps.map((s, i) => (
            <li key={i}>
              {s.ok ? "✓" : "✗"} {s.step}
              {s.detail ? ` (${s.detail})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Domains() {
  const { data, error, loading, reload } = useAsync(() => api.listDomains(), []);
  const domains = useMemo(() => data?.items ?? [], [data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preflights, setPreflights] = useState<Record<string, PreflightResult>>({});
  const [outcomes, setOutcomes] = useState<Record<string, ProvisionOutcome>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmProvision, setConfirmProvision] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [removing, setRemoving] = useState<Domain | null>(null);
  const [retryTakeover, setRetryTakeover] = useState<Domain | null>(null);

  const selectedZones = useMemo(() => [...selected], [selected]);

  function toggle(zoneId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === domains.length ? new Set() : new Set(domains.map((d) => d.cloudflareZoneId))));
  }

  async function runSync() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.syncDomains();
      setNotice(`Synced from Cloudflare: ${r.discovered} zone(s) discovered. No DNS was changed.`);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function runPreflight() {
    if (selectedZones.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.preflightDomains(selectedZones);
      setPreflights((prev) => {
        const next = { ...prev };
        for (const item of r.results) next[item.zoneId] = item;
        return next;
      });
      const conflicts = r.results.filter((x) => !x.safeToProvision && x.conflict).length;
      setNotice(
        conflicts > 0
          ? `Preflight done (read-only). ${conflicts} domain(s) have conflicts that will NOT be overwritten automatically.`
          : "Preflight done (read-only). No changes were made.",
      );
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : "Preflight failed");
    } finally {
      setBusy(false);
    }
  }

  // Does any selected (already-preflighted) domain have a foreign catch-all we'd take over?
  const needsTakeover = selectedZones.some((z) => preflights[z]?.classification === PreflightClassification.CatchAllConflict);
  const mxBlocked = selectedZones.some((z) => preflights[z]?.classification === PreflightClassification.MxConflict);

  async function runProvision() {
    if (selectedZones.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.provisionDomains(selectedZones, takeover);
      setOutcomes((prev) => {
        const next = { ...prev };
        for (const o of r.results) next[o.zoneId] = o;
        return next;
      });
      const ok = r.results.filter((o) => o.ok).length;
      setNotice(`Enabled mail on ${ok} of ${r.results.length} domain(s).`);
      setConfirmProvision(false);
      setSelected(new Set());
      reload();
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : "Provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  async function runRetry(d: Domain, withTakeover: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      const o = await api.retryDomain(d.cloudflareZoneId, withTakeover);
      setOutcomes((prev) => ({ ...prev, [o.zoneId]: o }));
      setRetryTakeover(null);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.removeDomain(removing.cloudflareZoneId);
      setNotice(`Removed ${removing.name} from MailVault. Your Cloudflare zone and DNS were NOT touched.`);
      setRemoving(null);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : "Remove failed");
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  function nameOf(zoneId: string): string {
    return domains.find((d) => d.cloudflareZoneId === zoneId)?.name ?? zoneId;
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Domains</h1>
        <div className="actions">
          <button onClick={runSync} disabled={busy}>
            {busy ? "Working…" : "↻ Sync from Cloudflare"}
          </button>
          <button onClick={runPreflight} disabled={busy || selectedZones.length === 0}>
            Preflight ({selectedZones.length})
          </button>
          <button
            className="primary"
            onClick={() => {
              setTakeover(false);
              setConfirmProvision(true);
            }}
            disabled={busy || selectedZones.length === 0}
          >
            Enable mail ({selectedZones.length})
          </button>
        </div>
      </div>

      {notice && <div className="banner ok">{notice}</div>}
      {error && <ErrorBanner message={error} />}
      {actionError && <ErrorBanner message={actionError} />}
      {loading && !data && <Loading />}

      {data && domains.length === 0 && (
        <div className="empty">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No domains tracked yet</div>
          <div className="muted" style={{ marginBottom: 14 }}>
            Sync to import the Cloudflare zones in your account. Nothing is modified by syncing.
          </div>
          <button className="primary" onClick={runSync} disabled={busy}>
            ↻ Sync from Cloudflare
          </button>
        </div>
      )}

      {domains.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={selected.size === domains.length && domains.length > 0}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Domain</th>
                <th>Zone</th>
                <th>Mail status</th>
                <th>Checked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => {
                const zoneId = d.cloudflareZoneId;
                const pf = preflights[zoneId];
                return (
                  <tr key={d.id} style={{ verticalAlign: "top" }}>
                    <td>
                      <input
                        type="checkbox"
                        style={{ width: "auto" }}
                        checked={selected.has(zoneId)}
                        onChange={() => toggle(zoneId)}
                        aria-label={`Select ${d.name}`}
                      />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{d.name}</div>
                      {pf && (
                        <div style={{ marginTop: 4 }}>
                          <ClassPill c={pf.classification} />
                        </div>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {d.zoneStatus}
                      <div className="faint">{d.zoneType === "full" ? "Full" : d.zoneType}</div>
                    </td>
                    <td>
                      <StatusPill status={d.mailStatus} />
                    </td>
                    <td className="faint" style={{ fontSize: 12 }}>
                      {relativeTime(d.lastCheckedAt)}
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {d.mailStatus === MailStatus.Ready && (
                          <button className="small" onClick={() => navigate(`/inbox?domain=${d.id}`)}>
                            Inbox
                          </button>
                        )}
                        {(d.mailStatus === MailStatus.Failed || d.mailStatus === MailStatus.Conflict) && (
                          <button
                            className="small"
                            disabled={busy}
                            onClick={() => {
                              // A stored catch-all conflict needs an explicit takeover confirmation.
                              if (d.conflictType === ConflictType.CatchAll) setRetryTakeover(d);
                              else void runRetry(d, false);
                            }}
                          >
                            Retry
                          </button>
                        )}
                        <button className="small danger" onClick={() => setRemoving(d)} disabled={busy}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-domain conflict / outcome evidence below the table. */}
      {selectedZones.map((z) => (preflights[z]?.conflict ? <ConflictBox key={`c-${z}`} result={preflights[z]!} /> : null))}
      {Object.values(outcomes).map((o) => (o && !o.ok ? <OutcomeBox key={`o-${o.zoneId}`} o={o} /> : null))}

      {confirmProvision && (
        <Modal title="Enable mail routing" onClose={() => setConfirmProvision(false)}>
          <p className="muted" style={{ marginTop: 0 }}>
            This changes Cloudflare settings for {selectedZones.length} domain(s): it enables Email Routing and installs a
            catch-all rule that delivers mail to MailVault.
          </p>
          <ul className="mono" style={{ paddingLeft: 18, fontSize: 12, marginBottom: 12 }}>
            {selectedZones.map((z) => (
              <li key={z}>{nameOf(z)}</li>
            ))}
          </ul>

          <div className="banner" style={{ marginBottom: 12 }}>
            <strong>MX records are never overwritten.</strong> Domains that point at another mail provider are reported as a
            conflict and skipped.
          </div>

          {mxBlocked && (
            <div className="banner error" style={{ marginBottom: 12 }}>
              Some selected domains have an MX conflict from preflight. They will be skipped; remove or fix them before
              enabling.
            </div>
          )}

          {needsTakeover && (
            <label className="row" style={{ cursor: "pointer", marginBottom: 12 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={takeover}
                onChange={(e) => setTakeover(e.target.checked)}
              />
              Take over the existing foreign catch-all rule (currently routing elsewhere)
            </label>
          )}
          {needsTakeover && takeover && (
            <div className="banner error" style={{ marginBottom: 12 }}>
              You are replacing another service's catch-all destination. Existing routing there will stop for unrouted
              addresses.
            </div>
          )}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmProvision(false)}>Cancel</button>
            <button className="primary" onClick={runProvision} disabled={busy || (needsTakeover && !takeover)}>
              {busy ? "Enabling…" : "Enable mail"}
            </button>
          </div>
        </Modal>
      )}

      {retryTakeover && (
        <Modal title="Retry with catch-all takeover" onClose={() => setRetryTakeover(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            <span className="addr">{retryTakeover.name}</span> has a foreign catch-all. Replace it so MailVault receives
            unrouted mail?
          </p>
          <div className="banner error" style={{ marginBottom: 12 }}>
            This overwrites the current catch-all destination. MX records are still never modified.
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button onClick={() => setRetryTakeover(null)}>Cancel</button>
            <button className="danger" onClick={() => runRetry(retryTakeover, true)} disabled={busy}>
              Take over catch-all
            </button>
          </div>
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove from MailVault"
          confirmLabel="Remove domain"
          description={
            <>
              <div style={{ marginBottom: 8 }}>
                Remove <span className="addr">{removing.name}</span> from MailVault?
              </div>
              <div className="banner" style={{ marginBottom: 0 }}>
                This only forgets the domain here. Your Cloudflare zone, DNS and Email Routing are <strong>not</strong>{" "}
                changed, and no zone is deleted.
              </div>
            </>
          }
          onConfirm={confirmRemove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

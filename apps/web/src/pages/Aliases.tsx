import { useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "../lib/api";
import {
  LocalPartMode,
  MailStatus,
  localPartProblem,
  normalizeLocalPartInput,
  type Alias,
  type CreateAliasInput,
  type Domain,
  type UpdateAliasInput,
} from "@mailvault/shared";
import { navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime } from "../lib/format";
import { ConfirmDialog, CopyButton, ErrorBanner, Loading, Menu, Modal, Row, useOpenRow } from "../components/ui";

function describeError(e: unknown): string {
  if (!(e instanceof ApiClientError)) return "Could not create alias";
  // The API already says which rule failed and why; showing only `message` gave the owner
  // "Validation failed" with nothing to act on.
  const details = e.details as Record<string, unknown> | undefined;
  const reasons = Object.values(details ?? {}).flatMap((v) => (Array.isArray(v) ? v.map(String) : []));
  return reasons.length ? reasons.join(" · ") : e.message;
}

function CreateAliasModal({ onClose, onCreated }: { onClose: () => void; onCreated: (a: Alias) => void }) {
  const { data: domains } = useAsync(() => api.listDomains(), []);
  const ready = useMemo(() => (domains?.items ?? []).filter((d) => d.mailStatus === MailStatus.Ready), [domains]);

  const [domainId, setDomainId] = useState("");
  const [mode, setMode] = useState<LocalPartMode>(LocalPartMode.ServiceRandom);
  const [service, setService] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!domainId && ready[0]) setDomainId(ready[0].id);
  }, [ready, domainId]);

  const domain: Domain | undefined = ready.find((d) => d.id === domainId);
  const problem = mode === LocalPartMode.Custom && localPart.trim() ? localPartProblem(localPart) : null;
  const missingName = mode === LocalPartMode.Custom && !localPart.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const base = { domainId, label: label.trim() || null };
    // Sent as typed: the API normalizes, so what the owner sees in the preview is exactly
    // what the server will store.
    const input: CreateAliasInput =
      mode === LocalPartMode.Custom
        ? { ...base, mode: LocalPartMode.Custom, localPart }
        : mode === LocalPartMode.ServiceRandom
          ? { ...base, mode: LocalPartMode.ServiceRandom, service: service.trim() }
          : { ...base, mode: LocalPartMode.Random };
    try {
      const created = await api.createAlias(input);
      onCreated(created);
      onClose();
    } catch (e2) {
      setErr(describeError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create alias" onClose={onClose}>
      {ready.length === 0 ? (
        <>
          <div className="muted" style={{ marginBottom: 14 }}>
            No domains are Ready for mail yet. Enable mail on a domain first.
          </div>
          <button className="primary" onClick={() => (onClose(), navigate("/domains"))}>
            Go to Domains
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          {err && <ErrorBanner message={err} />}
          <div className="field">
            <label>Domain</label>
            <select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
              {ready.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Label (optional)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="GitHub Personal" maxLength={120} />
          </div>
          <div className="field">
            <label>Type</label>
            <div className="tabs">
              <button type="button" className={mode === LocalPartMode.ServiceRandom ? "active" : ""} onClick={() => setMode(LocalPartMode.ServiceRandom)}>
                Service
              </button>
              <button type="button" className={mode === LocalPartMode.Random ? "active" : ""} onClick={() => setMode(LocalPartMode.Random)}>
                Random
              </button>
              <button type="button" className={mode === LocalPartMode.Custom ? "active" : ""} onClick={() => setMode(LocalPartMode.Custom)}>
                Custom
              </button>
            </div>
          </div>
          {mode === LocalPartMode.ServiceRandom && (
            <div className="field">
              <label>Service name</label>
              <input value={service} onChange={(e) => setService(e.target.value)} placeholder="github" />
              {domain && <Preview local={service ? `${service.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase()}-…` : "service-…"} domain={domain.name} />}
            </div>
          )}
          {mode === LocalPartMode.Random && domain && <Preview local="x7k29p" domain={domain.name} />}
          {mode === LocalPartMode.Custom && (
            <div className="field">
              <label htmlFor="alias-local-part">Custom local part</label>
              <input
                id="alias-local-part"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                placeholder="github03"
                maxLength={64}
                aria-invalid={!!problem}
                aria-describedby={problem ? "alias-local-part-problem" : undefined}
              />
              {/* The reason appears while typing, not after a failed submit, and the preview
                  shows the address the server will actually store (`Tung` → `tung`). */}
              {problem && (
                <div className="field-problem" id="alias-local-part-problem" role="alert">
                  {problem}
                </div>
              )}
              {domain && <Preview local={normalizeLocalPartInput(localPart) || "…"} domain={domain.name} />}
            </div>
          )}
          <div className="row-end" style={{ marginTop: 8 }}>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !domainId || !!problem || missingName}>
              {busy ? "Creating…" : "Create alias"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Preview({ local, domain }: { local: string; domain: string }) {
  return (
    <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
      Will create: <span className="addr">{local}@{domain}</span>
    </div>
  );
}

export function Aliases({ openNew }: { openNew: boolean }) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"active" | "archived" | "all">("active");
  const { data, error, loading, reload } = useAsync(() => api.listAliases(q || undefined, view), [q, view]);
  const [showNew, setShowNew] = useState(openNew);
  const [deleting, setDeleting] = useState<Alias | null>(null);
  const [purge, setPurge] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const folded = useOpenRow();

  useEffect(() => {
    if (openNew) setShowNew(true);
  }, [openNew]);

  async function toggleStatus(a: Alias) {
    if (a.status === "ACTIVE") await api.disableAlias(a.id);
    else await api.enableAlias(a.id);
    folded.close();
    reload();
  }

  async function patch(a: Alias, changes: UpdateAliasInput) {
    try {
      await api.updateAlias(a.id, changes);
      folded.close();
      reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : "Update failed");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.deleteAlias(deleting.id, purge);
      setDeleting(null);
      setNotice(purge ? "Alias and its messages deleted" : "Alias deleted — existing mail kept");
      setPurge(false);
      reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : "Delete failed");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Aliases</h1>
        <div className="actions">
          <button className="primary" onClick={() => setShowNew(true)}>
            + Create alias
          </button>
        </div>
      </div>

      {notice && <div className="banner ok">{notice}</div>}
      {error && <ErrorBanner message={error} />}

      <div className="toolbar">
        <input className="search" placeholder="Search address, label or note…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tabs" role="tablist">
          {(["active", "archived", "all"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
              {v === "active" ? "Active" : v === "archived" ? "Archived" : "All"}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <Loading />}
      {data && data.items.length === 0 && (
        <Empty q={q} onCreate={() => setShowNew(true)} />
      )}

      {data && data.items.length > 0 && (
        <div className="card card--flush">
          {data.items.map((a) => (
            <Row
              key={a.id}
              id={a.id}
              open={folded.open === a.id}
              onToggle={folded.toggle}
              summary={
                <>
                  <div className="entity-title">
                    <div className="entity-name">
                      {a.pinned ? "📌 " : null}
                      {a.label || <span className="muted">No label</span>}
                    </div>
                    <span className={`pill ${a.status === "ACTIVE" ? "ready" : "neutral"}`}>
                      {a.status === "ACTIVE" ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <div className="addr entity-addr">{a.address}</div>
                  {a.notes ? (
                    <div className="entity-note" title={a.notes}>
                      {a.notes}
                    </div>
                  ) : null}
                  <div className="entity-facts">
                    <span>{a.messageCount ?? 0} messages</span>
                    <span>{a.unreadCount ? `${a.unreadCount} unread` : "all read"}</span>
                    <span>created {relativeTime(a.createdAt)}</span>
                    {a.archived ? <span>archived</span> : null}
                  </div>
                </>
              }
              actions={
                <>
                  <CopyButton text={a.address} label="Copy address" />
                  <button className="small" onClick={() => navigate(`/inbox?alias=${a.id}`)}>
                    Mail here
                  </button>
                  <button className="small" onClick={() => toggleStatus(a)}>
                    {a.status === "ACTIVE" ? "Disable" : "Enable"}
                  </button>
                  <Menu
                    small
                    items={[
                      { label: "Open details", onSelect: () => navigate(`/aliases/${a.id}`) },
                      { label: a.pinned ? "Unpin" : "Pin", onSelect: () => patch(a, { pinned: !a.pinned }) },
                      { label: a.archived ? "Unarchive" : "Archive", onSelect: () => patch(a, { archived: !a.archived }) },
                      { label: "Delete", danger: true, onSelect: () => setDeleting(a) },
                    ]}
                  />
                </>
              }
            />
          ))}
        </div>
      )}

      {showNew && <CreateAliasModal onClose={() => setShowNew(false)} onCreated={() => reload()} />}

      {deleting && (
        <ConfirmDialog
          title="Delete alias"
          confirmLabel={purge ? "Delete alias + all messages" : "Delete alias"}
          description={
            <>
              <div style={{ marginBottom: 10 }}>
                Remove <span className="addr">{deleting.address}</span>? New mail to this address will stop being accepted.
              </div>
              <label className="row" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={purge}
                  onChange={(e) => setPurge(e.target.checked)}
                />
                Also permanently delete all existing messages for this alias
              </label>
              {purge && (
                <div className="banner error" style={{ marginTop: 10, marginBottom: 0 }}>
                  This permanently deletes {deleting.messageCount ?? 0} stored message(s). This cannot be undone.
                </div>
              )}
            </>
          }
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function Empty({ q, onCreate }: { q: string; onCreate: () => void }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{q ? "No matching aliases" : "No aliases yet"}</div>
      <div className="muted" style={{ marginBottom: 14 }}>
        {q ? "Try a different search." : "Create your first alias to start receiving mail."}
      </div>
      {!q && (
        <button className="primary" onClick={onCreate}>
          + Create alias
        </button>
      )}
    </div>
  );
}

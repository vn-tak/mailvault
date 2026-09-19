import { useEffect, useState } from "react";
import { api, ApiClientError } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { fullTime, relativeTime } from "../lib/format";
import { CopyButton, ErrorBanner, Loading } from "../components/ui";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div className="faint" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function AliasDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => api.getAlias(id), [id]);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Re-seed the form whenever the server copy changes (including after a save).
  useEffect(() => {
    if (!data) return;
    setLabel(data.alias.label ?? "");
    setNotes(data.alias.notes ?? "");
    setDirty(false);
  }, [data]);

  async function save() {
    try {
      await api.updateAlias(id, { label: label.trim() || null, notes: notes.trim() || null });
      setNotice("Saved");
      reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : "Save failed");
    }
  }

  async function patch(changes: { pinned?: boolean; archived?: boolean }) {
    try {
      await api.updateAlias(id, changes);
      reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : "Update failed");
    }
  }

  if (loading && !data) return <Loading />;

  const a = data?.alias;
  const stats = data?.stats;

  return (
    <div className="page">
      <div style={{ marginBottom: 14 }}>
        <Link to="/aliases">← Back to aliases</Link>
      </div>

      {notice && <div className="banner ok">{notice}</div>}
      {error && <ErrorBanner message={error} />}

      {a && stats && (
        <>
          <div className="card">
            <div className="row spread wrap" style={{ gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h1 style={{ marginBottom: 4, wordBreak: "break-all" }}>
                  {a.pinned ? "📌 " : null}
                  {a.label || "No label"}
                </h1>
                <div className="addr muted">{a.address}</div>
                <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                  {a.status === "ACTIVE" ? "Receiving" : "Not receiving"} · {a.domainName} · created {relativeTime(a.createdAt)}
                </div>
              </div>
              <div className="row wrap" style={{ justifyContent: "flex-end" }}>
                <CopyButton text={a.address} label="Copy address" />
                <button className="small" onClick={() => patch({ pinned: !a.pinned })}>
                  {a.pinned ? "Unpin" : "Pin"}
                </button>
                <button className="small" onClick={() => patch({ archived: !a.archived })}>
                  {a.archived ? "Unarchive" : "Archive"}
                </button>
                <button className="small" onClick={() => navigate(`/inbox?alias=${a.id}`)}>
                  Open inbox
                </button>
              </div>
            </div>
          </div>

          <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Stat label="Messages" value={String(stats.messages)} />
            <Stat label="Unread" value={String(stats.unread)} />
            <Stat label="First mail" value={stats.firstReceivedAt ? fullTime(stats.firstReceivedAt) : "—"} />
            <Stat label="Last mail" value={stats.lastReceivedAt ? `${relativeTime(stats.lastReceivedAt)}` : "—"} />
          </div>

          <div className="mt">
            <h2>Notes</h2>
            <textarea
              className="search"
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
              placeholder="What is this address for, where it was handed out, when to retire it…"
              value={notes}
              maxLength={1000}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
            />
          </div>

          <div className="mt">
            <h2>Label</h2>
            <input
              className="search"
              value={label}
              maxLength={120}
              placeholder="e.g. GitHub sign-in"
              onChange={(e) => {
                setLabel(e.target.value);
                setDirty(true);
              }}
            />
          </div>

          <div className="row-end mt">
            <button className="primary" disabled={!dirty} onClick={save}>
              Save
            </button>
          </div>

          <div className="mt">
            <h2>Who writes to it</h2>
            {stats.senders.length === 0 ? (
              <p className="muted">Nothing has arrived yet.</p>
            ) : (
              <div className="stack">
                {stats.senders.map((s) => (
                  <div key={s.name} className="row spread" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>
                      {s.name}
                    </span>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {s.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

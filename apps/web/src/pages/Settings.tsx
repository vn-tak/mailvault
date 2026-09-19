import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "../lib/api";
import { disablePush, enablePush, pushState, type PushState } from "../lib/push";

type Status = { tone: "ok" | "error"; text: string } | null;

export function Settings() {
  const [state, setState] = useState<PushState | null>(null);
  const [server, setServer] = useState<{ enabled: boolean; subscriptions: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const refresh = useCallback(async () => {
    const [local, remote] = await Promise.all([pushState(), api.pushStatus().catch(() => null)]);
    setState(local);
    setServer(remote);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setStatus(null);
    try {
      const result = await action();
      setStatus({ tone: result.ok ? "ok" : "error", text: result.message });
      await refresh();
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof ApiClientError ? e.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  }

  const subscribed = !!state?.subscribed;
  const configured = server?.enabled ?? false;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Notifications</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Your phone or laptop is told that new mail arrived — nothing else. The subject, sender, codes and links stay
          behind the sign-in, and the notification carries no content at all.
        </p>

        <table style={{ marginBottom: 12 }}>
          <tbody>
            <tr>
              <td className="muted">Server</td>
              <td>{configured ? "Push enabled" : "Not configured (set VAPID_PRIVATE_KEY)"}</td>
            </tr>
            <tr>
              <td className="muted">This browser</td>
              <td>
                {subscribed ? "Subscribed" : `Not subscribed${state && state.permission !== "default" ? ` · permission: ${state.permission}` : ""}`}
              </td>
            </tr>
            <tr>
              <td className="muted">Devices known to the server</td>
              <td>{server ? String(server.subscriptions) : "—"}</td>
            </tr>
          </tbody>
        </table>

        {status && <div className={`banner ${status.tone === "ok" ? "ok" : "error"}`}>{status.text}</div>}

        <div className="row wrap" style={{ marginTop: 12 }}>
          {!subscribed && (
            <button className="primary" disabled={busy || !configured} onClick={() => run(enablePush)}>
              Turn on notifications
            </button>
          )}
          {subscribed && (
            <button disabled={busy} onClick={() => run(disablePush)}>
              Turn off
            </button>
          )}
          {subscribed && (
            <button
              className="small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api.pushTest();
                  return { ok: r.sent > 0, message: r.sent ? `Sent to ${r.sent} device(s).` : `Nothing sent${r.skipped ? ` (${r.skipped})` : "."}` };
                })
              }
            >
              Send a test notification
            </button>
          )}
        </div>
        {state?.support === "unsupported" && (
          <p className="faint" style={{ fontSize: 12 }}>
            This browser cannot receive notifications.
          </p>
        )}
        {state?.support === "insecure" && (
          <p className="faint" style={{ fontSize: 12 }}>
            Notifications require an HTTPS origin.
          </p>
        )}
      </div>

      <div className="card mt">
        <h2 style={{ marginTop: 0 }}>Install</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          MailVault is installable: use your browser&apos;s &quot;Install app&quot; (or Share → Add to Home Screen on iOS)
          to get its own window. It works offline for the screens you already opened; mail and attachments are never
          cached.
        </p>
      </div>
    </div>
  );
}

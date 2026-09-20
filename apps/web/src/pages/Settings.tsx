import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "../lib/api";
import { disablePush, enablePush, pushState, type PushState } from "../lib/push";
import { registerPasskey, removePasskey } from "../lib/passkeys";
import { useAsync } from "../lib/useAsync";
import { relativeTime } from "../lib/format";

type Status = { tone: "ok" | "error"; text: string } | null;

const errText = (e: unknown) => (e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : "Request failed");

/**
 * Passkeys are what make an irreversible action cost more than a session cookie. The
 * browser prompts for them, so the only way to add one is a real gesture here.
 */
function PasskeysCard() {
  const { data, loading, reload } = useAsync(() => api.securityStatus(), []);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const supported = typeof window !== "undefined" && "PublicKeyCredential" in window;

  async function add() {
    setBusy(true);
    setStatus(null);
    try {
      await registerPasskey();
      setStatus({ tone: "ok", text: "Passkey registered. It will be asked for before mail is purged or a domain is detached." });
      reload();
    } catch (e) {
      setStatus({ tone: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function drop(id: string) {
    setBusy(true);
    setStatus(null);
    try {
      await removePasskey(id);
      setStatus({ tone: "ok", text: "Passkey removed." });
      reload();
    } catch (e) {
      setStatus({ tone: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt">
      <h2 style={{ marginTop: 0 }}>Passkey check</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Signing in proves which account you are. This proves the same person is holding this
        device, and it is asked for before anything that cannot be undone: purging an
        alias&apos;s stored mail, detaching a domain, turning sender checks off, or adding
        another passkey. It lasts a few minutes, then asks again.
      </p>

      {loading && !data ? (
        <p className="faint">Loading…</p>
      ) : (
        <>
          {data && data.passkeys.length > 0 ? (
            <ul className="msglist">
              {data.passkeys.map((p) => (
                <li key={p.id} className="entity">
                  <div className="entity-summary">
                    <div className="entity-id">
                      <div className="entity-name">{p.deviceLabel || "Passkey"}</div>
                      <div className="entity-facts">
                        <span>added {relativeTime(p.createdAt)}</span>
                        <span>{p.lastUsedAt ? `last used ${relativeTime(p.lastUsedAt)}` : "never used"}</span>
                        {p.transports?.length ? <span>{p.transports.join(", ")}</span> : null}
                      </div>
                    </div>
                    <button className="ghost small" disabled={busy} onClick={() => drop(p.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="banner">
              No passkey registered yet, so irreversible actions currently rely on your sign-in
              alone.
            </div>
          )}

          {status && <div className={`banner ${status.tone === "ok" ? "ok" : "error"}`}>{status.text}</div>}

          <div className="row wrap" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy || !supported} onClick={add}>
              {data?.passkeys.length ? "Add another passkey" : "Register a passkey"}
            </button>
          </div>

          {!supported && (
            <p className="faint" style={{ fontSize: 12 }}>
              This browser cannot use passkeys.
            </p>
          )}
          {data?.rpId && (
            <p className="faint" style={{ fontSize: 12 }}>
              Keys are bound to <span className="addr">{data.rpId}</span>; a passkey added here
              will not unlock the app on another hostname.
            </p>
          )}
        </>
      )}
    </div>
  );
}

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
          The ping your device receives carries no content at all. The app then looks the
          message up through your sign-in and shows sender and subject — only for a verified
          sender, never a code or a link, and only mail that just arrived. Anything else stays
          "New mail arrived".
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

      <PasskeysCard />

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

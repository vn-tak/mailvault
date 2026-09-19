import { useEffect, useState } from "react";
import { MailStatus } from "@mailvault/shared";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" /> {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="banner error">{message}</div>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {hint ? <div className="muted" style={{ fontSize: 13 }}>{hint}</div> : null}
    </div>
  );
}

const STATUS_PILL: Record<string, { cls: string; text: string }> = {
  [MailStatus.Ready]: { cls: "ready", text: "Ready" },
  [MailStatus.Conflict]: { cls: "conflict", text: "Conflict" },
  [MailStatus.Failed]: { cls: "error", text: "Error" },
  [MailStatus.Provisioning]: { cls: "accent", text: "Provisioning" },
  [MailStatus.Verifying]: { cls: "accent", text: "Verifying" },
  [MailStatus.Preflight]: { cls: "accent", text: "Preflight" },
  [MailStatus.Disabled]: { cls: "neutral", text: "Disabled" },
  [MailStatus.Discovered]: { cls: "neutral", text: "Not configured" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_PILL[status] ?? { cls: "neutral", text: status };
  return <span className={`pill ${s.cls}`}>{s.text}</span>;
}

/** Clipboard with a transient "Copied" confirmation. */
export function CopyButton({ text, label = "Copy", small }: { text: string; label?: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
  }

  return (
    <button className={`small ${small ? "ghost" : ""}`} onClick={copy} aria-label={`Copy ${text}`}>
      {copied ? "Copied" : label}
    </button>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row spread">
          <h2>{title}</h2>
          <button className="ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="mt">{children}</div>
      </div>
    </div>
  );
}

/** Destructive-action confirm requiring the owner to click an explicit danger button. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="muted" style={{ marginBottom: 18 }}>{description}</div>
      <div className="row-end">
        <button onClick={onClose}>Cancel</button>
        <button className={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

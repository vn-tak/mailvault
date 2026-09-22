import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { attachmentHref } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { formatBytes, fullTime, senderName } from "../lib/format";
import { t } from "../lib/i18n";
import { MessageHtml } from "../components/MessageHtml";
import { TextBody } from "../components/TextBody";
import { ConfirmDialog, CopyButton, ErrorBanner, Loading, Monogram } from "../components/ui";
import { Composer } from "../components/Composer";
import { AuthVerdict, MessageDirection, type ExtractedCode, type MessageAuth, type VerificationLink } from "@mailvault/shared";

function byConfidence(a: ExtractedCode, b: ExtractedCode): number {
  return b.confidence - a.confidence || b.length - a.length;
}

function byScore(a: VerificationLink, b: VerificationLink): number {
  return b.score - a.score;
}

function CodeCard({ code }: { code: ExtractedCode }) {
  return (
    <div className="code-card">
      <div>
        <div className="code">{code.value}</div>
        <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
          {t(code.kind === "numeric" ? "msg.numericCode" : "msg.code")} · {t("msg.codeLength", { n: code.length })}
        </div>
      </div>
      <CopyButton text={code.value} label={t("msg.copyCode")} />
    </div>
  );
}

function displayHost(link: VerificationLink): string {
  try {
    return new URL(link.destination ?? link.url).hostname;
  } catch {
    return link.hostname;
  }
}

function LinkCard({ link }: { link: VerificationLink }) {
  const target = link.destination ?? link.url;
  const wrapped = !!link.destination && link.destination !== link.url;
  return (
    <div className="link-card">
      <div className="link-card-head">
        <span className="link-title">{link.label || t("msg.verificationLink")}</span>
        <span className="link-host">{displayHost(link)}</span>
      </div>
      {wrapped && (
        <div className="link-via">
          {t("msg.trackingA")}
          <span className="addr">{link.hostname}</span>
          {t("msg.trackingB")}
        </div>
      )}
      {/* The whole address, readable and selectable: a 400-char magic link behind an "Open"
          button tells the owner nothing about where their token is going. */}
      <div className="link-url">{target}</div>
      <div className="row wrap" style={{ gap: 8 }}>
        <CopyButton text={target} label={t("msg.copyLink")} />
        {/* Explicit user action only: never auto-followed, never prefetched. */}
        <a
          className="small"
          href={target}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={t("msg.openAria", { host: displayHost(link) })}
        >
          {t("msg.open")}
        </a>
        {wrapped && (
          <a className="small ghost" href={link.url} target="_blank" rel="noopener noreferrer nofollow">
            {t("msg.openAsSent")}
          </a>
        )}
      </div>
    </div>
  );
}

function outcomeLabel(auth: MessageAuth | null): string {
  if (!auth) return t("msg.authNotAssessed");
  const mark = (mech: "spf" | "dkim" | "dmarc", value: string | null) =>
    value ? `${mech}=${value}${auth.alignedPass[mech] ? "*" : ""}` : null;
  const parts = [mark("spf", auth.spf), mark("dkim", auth.dkim), mark("dmarc", auth.dmarc)].filter(Boolean);
  if (parts.length === 0) return t("msg.authNone");
  const aligned = auth.alignedPass.spf || auth.alignedPass.dkim || auth.alignedPass.dmarc;
  return aligned
    ? `${parts.join("  ")}  ${t("msg.authVouches")}`
    : `${parts.join("  ")}  ${t("msg.authNoVouch")}`;
}

function AuthBanner({ verdict, auth }: { verdict: AuthVerdict; auth: MessageAuth | null }) {
  // Mail stored before authentication existed has nothing to report; saying "not
  // verified" every time would train the owner to ignore the real warning.
  if (!auth && verdict !== AuthVerdict.Spoofed) return null;
  const head =
    verdict === AuthVerdict.Trusted ? "msg.authTrusted" : verdict === AuthVerdict.Spoofed ? "msg.authSpoofed" : "msg.authUnverified";
  const cls = verdict === AuthVerdict.Trusted ? "trusted" : verdict === AuthVerdict.Spoofed ? "spoofed" : "unverified";
  return (
    <div className={`ribbon ${cls} mt`} role="status">
      <span className="dot" aria-hidden="true" />
      <span className="ribbon-body">
        <span className="head">{t(head)}</span>
        <span className="detail">{outcomeLabel(auth)}</span>
        {verdict === AuthVerdict.Spoofed && auth?.reasons.length ? (
          <span className="detail">{t("msg.authWhy", { reasons: auth.reasons.join("; ") })}</span>
        ) : null}
      </span>
    </div>
  );
}

export function MessageDetail({
  id,
  pane,
  onClose,
  onRead,
  onOpenMessage,
}: {
  id: string;
  /** Rendered inside the inbox's reading pane rather than as its own screen. */
  pane?: boolean;
  onClose?: () => void;
  /** Marks read and lets the list move on, so `j` keeps its rhythm. */
  onRead?: (id: string) => void;
  /** Inside the pane, a thread entry swaps the pane rather than leaving the list. */
  onOpenMessage?: (id: string) => void;
}) {
  const [remoteImages, setRemoteImages] = useState(false);
  const [showText, setShowText] = useState(false);
  const [revealSpoofed, setRevealSpoofed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replying, setReplying] = useState(false);
  const markedRef = useRef<string | null>(null);

  const { data, error, loading, reload } = useAsync(() => api.getMessage(id, remoteImages), [id, remoteImages]);
  /*
   * The conversation, asked for by root rather than by this message: opening any reply
   * has to show the whole thread, including the one you are reading.
   */
  const threadId = data?.threadRootId ?? data?.id ?? null;
  const { data: thread, reload: reloadThread } = useAsync(
    () => (threadId ? api.thread(threadId) : Promise.resolve({ id: "", items: [] })),
    [threadId],
  );
  const { data: capabilities } = useAsync(() => api.outboxCapabilities(), []);
  const { data: aliasPage } = useAsync(() => api.listAliases(), []);
  const sendableAliases = useMemo(() => {
    const sendable = new Set((capabilities?.domains ?? []).filter((d) => d.canSend).map((d) => d.domainId));
    return (aliasPage?.items ?? [])
      .filter((a) => a.status === "ACTIVE" && sendable.has(a.domainId))
      .map((a) => ({ address: a.address, label: a.label }));
  }, [aliasPage, capabilities]);

  // Opening a message marks it read once per id; ignore failures silently.
  useEffect(() => {
    if (!data || data.isRead || markedRef.current === data.id) return;
    markedRef.current = data.id;
    void api
      .setMessageRead(data.id, true)
      .then(reload)
      .catch(() => {
        /* non-critical */
      });
  }, [data, reload]);

  const codes = useMemo(() => (data?.extractedCodes ?? []).slice().sort(byConfidence), [data]);
  const links = useMemo(() => (data?.verificationLinks ?? []).slice().sort(byScore), [data]);
  // A spoofed message's "code" and "verify link" are the payload a phisher wants read,
  // so they stay hidden until the owner explicitly asks for them.
  const hidingSecrets = !!data && data.authVerdict === AuthVerdict.Spoofed && !revealSpoofed;

  async function toggleRead() {
    if (!data) return;
    const next = !data.isRead;
    // In the pane, reading something is also a request to be shown the next one.
    if (next && onRead) {
      onRead(data.id);
      return;
    }
    await api.setMessageRead(data.id, next).catch(() => undefined);
    reload();
  }

  async function remove() {
    try {
      await api.deleteMessage(id);
      navigate("/inbox");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("common.deleteFail"));
      setConfirmDelete(false);
    }
  }

  return (
    <div className={pane ? "pane-body" : "page"}>
      {pane ? (
        <div className="pane-bar">
          <span className="eyebrow">{t("msg.body")}</span>
          <button className="ghost small" aria-label={t("common.close")} onClick={onClose}>
            ✕
          </button>
        </div>
      ) : (
        <div className="backrow">
          <Link className="backlink" to="/inbox">{t("msg.back")}</Link>
        </div>
      )}

      {notice && <div className="banner ok">{notice}</div>}
      {error && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="card">
            <div className="detail-head">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="subject-head">
                  <Monogram name={senderName(data.headerFrom, data.envelopeFrom)} large />
                  <div style={{ minWidth: 0 }}>
                    <h1 style={{ marginBottom: 6 }}>{data.subject || t("inbox.noSubject")}</h1>
                    <div className="subject-meta">
                      <span className="who">
                        {senderName(data.headerFrom, data.envelopeFrom)}
                        <span className="addr"> · {data.envelopeFrom}</span>
                      </span>
                      <span>
                        {t("msg.to")} <span className="addr">{data.headerTo || data.aliasAddress}</span>
                      </span>
                      <span>
                        {fullTime(data.receivedAt)}
                        {data.aliasLabel ? ` · ${data.aliasLabel}` : ""} {t("msg.arrivedAt", { address: data.aliasAddress })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="row wrap actions-cell">
                <button
                  className="small primary"
                  onClick={() => setReplying(true)}
                  disabled={!data.aliasAddress || !sendableAliases.some((a) => a.address === data.aliasAddress)}
                  title={t("composer.noAliases")}
                >
                  {t("msg.reply")}
                </button>
                <button className="small" onClick={toggleRead}>
                  {t(data.isRead ? "msg.markUnread" : "msg.markRead")}
                </button>
                <button className="small danger" onClick={() => setConfirmDelete(true)}>
                  {t("msg.delete")}
                </button>
              </div>
            </div>
          </div>

          {data.parseDegraded && <div className="banner error mt">{t("msg.degraded")}</div>}

          {/* Our own outgoing mail has no external sender to authenticate: Email Sending
              signs it with this domain's own key, so a verdict banner would only confuse. */}
          {data.direction === MessageDirection.In ? <AuthBanner verdict={data.authVerdict} auth={data.auth ?? null} /> : null}

          {data.direction === MessageDirection.Out ? (
            <div className={`banner mt ${data.sendStatus === "FAILED" ? "error" : ""}`}>
              <span className="muted">{t(`send.status.${data.sendStatus ?? "QUEUED"}`)}</span>
              {data.sendError ? <div className="faint detail">{data.sendError}</div> : null}
            </div>
          ) : null}

          {/* Says why this mail is where it is, in the words the rule had at the time —
              so an archive still explains itself after the rule is edited or deleted. */}
          {data.appliedRuleNote && (
            <div className="banner mt">
              <span className="muted">{t("msg.filedAuto", { note: data.appliedRuleNote })}</span>{" "}
              <Link to="/aliases">{t("msg.reviewRules")}</Link>
            </div>
          )}

          {hidingSecrets && (codes.length > 0 || links.length > 0) ? (
            <div className="banner error mt">
              <div>
                <strong>{t("msg.secretsHidden")}</strong>
                {t("msg.secretsHiddenBody")}
              </div>
              <button className="small danger" style={{ marginTop: 8 }} onClick={() => setRevealSpoofed(true)}>
                {t("msg.showAnyway", { n: codes.length + links.length })}
              </button>
            </div>
          ) : null}

          {codes.length > 0 && !hidingSecrets && (
            <div className="mt">
              <h2>{t("msg.codes")}</h2>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {codes.map((c, i) => (
                  <CodeCard key={`${c.value}-${i}`} code={c} />
                ))}
              </div>
            </div>
          )}

          {links.length > 0 && !hidingSecrets && (
            <div className="mt">
              <h2>{t("msg.links")}</h2>
              <div className="stack">
                {links.map((l, i) => (
                  <LinkCard key={`${l.url}-${i}`} link={l} />
                ))}
              </div>
            </div>
          )}

          {data.attachments.length > 0 && (
            <div className="mt">
              <h2>{t("msg.attachments")}</h2>
              <div className="stack">
                {data.attachments.map((a) => (
                  <div key={a.id} className="attach">
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.filename}
                    </span>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {a.contentType} · {formatBytes(a.size)}
                    </span>
                    {/* Authenticated same-origin download; never a public URL. */}
                    <a className="small" href={attachmentHref(data.id, a.id)} rel="noreferrer" style={{ textDecoration: "none" }}>
                      {t("msg.download")}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt">
            <div className="row spread wrap" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{t("msg.body")}</h2>
              <div className="row wrap" style={{ justifyContent: "flex-end", fontSize: 12 }}>
                {data.htmlBody && (
                  <button className="small ghost" onClick={() => setShowText((s) => !s)}>
                    {t(showText ? "msg.showHtml" : "msg.showPlain")}
                  </button>
                )}
                {data.htmlBody && !remoteImages && (
                  <button className="small" onClick={() => setRemoteImages(true)}>
                    {t("msg.loadImages")}
                  </button>
                )}
                {remoteImages && (
                  <button className="small ghost" onClick={() => setRemoteImages(false)}>
                    {t("msg.hideImages")}
                  </button>
                )}
              </div>
            </div>

            {remoteImages && data.htmlBody && (
              <div className="banner" style={{ marginBottom: 10 }}>
                {t("msg.imagesWarn")}
              </div>
            )}

            {showText || !data.htmlBody ? (
              data.textBody ? (
                <TextBody text={data.textBody} />
              ) : (
                <p className="muted">{t("msg.noBody")}</p>
              )
            ) : (
              <MessageHtml html={data.htmlBody} />
            )}
          </div>
        </>
      )}

      {/*
        The conversation under the message you asked for. A reply that appears somewhere
        else is the failure this removes: the whole exchange, in order, on one screen —
        including your own outgoing answers, which live in the same table.
      */}
      {data && thread && thread.items.length > 1 ? (
        <section className="thread mt">
          <h2 className="thread-title">
            {t("msg.threadTitle")} <span className="faint">{thread.items.length}</span>
          </h2>
          <ol className="thread-list">
            {thread.items.map((m) => {
              const current = m.id === data.id;
              const label =
                m.direction === MessageDirection.Out
                  ? `${t("msg.youSent")} → ${m.headerTo || m.aliasAddress}`
                  : senderName(m.headerFrom, m.envelopeFrom);
              const body = (
                <>
                  <span className={`thread-dir ${m.direction === MessageDirection.Out ? "out" : ""}`}>
                    {m.direction === MessageDirection.Out ? "↗" : "↘"}
                  </span>
                  <span className="thread-who">{label}</span>
                  <span className="thread-preview">{m.subject || t("inbox.noSubject")}</span>
                  <span className="thread-time faint">{fullTime(m.receivedAt)}</span>
                </>
              );
              return (
                <li key={m.id} aria-current={current ? "true" : undefined} className={current ? "is-current" : ""}>
                  {onOpenMessage ? (
                    <button type="button" className="thread-link" onClick={() => onOpenMessage(m.id)}>
                      {body}
                    </button>
                  ) : (
                    <Link to={`/messages/${m.id}`} className="thread-link">
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {replying ? (
        <Composer
          replyTo={data}
          sendableAliases={sendableAliases}
          remaining={capabilities?.remaining ?? 0}
          bindingMissing={capabilities?.bindingMissing}
          onClose={() => setReplying(false)}
          onSent={() => {
            setReplying(false);
            reload();
            reloadThread();
            setNotice(t("msg.replySent"));
          }}
        />
      ) : null}

      {confirmDelete && (
        <ConfirmDialog
          title={t("msg.deleteTitle")}
          confirmLabel={t("msg.deleteConfirm")}
          description={t("msg.deleteBody")}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

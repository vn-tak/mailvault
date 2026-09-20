import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { attachmentHref } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { formatBytes, fullTime, senderName } from "../lib/format";
import { t } from "../lib/i18n";
import { MessageHtml } from "../components/MessageHtml";
import { TextBody } from "../components/TextBody";
import { ConfirmDialog, CopyButton, ErrorBanner, Loading } from "../components/ui";
import { AuthVerdict, type ExtractedCode, type MessageAuth, type VerificationLink } from "@mailvault/shared";

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
  if (verdict === AuthVerdict.Trusted) {
    return (
      <div className="banner ok mt" style={{ fontSize: 13 }}>
        {t("msg.authTrusted", { what: outcomeLabel(auth) })}
      </div>
    );
  }
  if (verdict === AuthVerdict.Spoofed) {
    return (
      <div className="banner error mt" style={{ fontSize: 13 }}>
        <strong>{t("msg.authSpoofed")}</strong>
        <div style={{ marginTop: 4 }}>{outcomeLabel(auth)}</div>
        {auth?.reasons.length ? <div className="faint">{t("msg.authWhy", { reasons: auth.reasons.join("; ") })}</div> : null}
      </div>
    );
  }
  return (
    <div className="banner mt" style={{ fontSize: 13 }}>
      {t("msg.authUnverified", { what: outcomeLabel(auth) })}
    </div>
  );
}

export function MessageDetail({ id }: { id: string }) {
  const [remoteImages, setRemoteImages] = useState(false);
  const [showText, setShowText] = useState(false);
  const [revealSpoofed, setRevealSpoofed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const markedRef = useRef<string | null>(null);

  const { data, error, loading, reload } = useAsync(() => api.getMessage(id, remoteImages), [id, remoteImages]);

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
    await api.setMessageRead(data.id, !data.isRead).catch(() => undefined);
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
    <div className="page">
      <div className="backrow">
        <Link className="backlink" to="/inbox">{t("msg.back")}</Link>
      </div>

      {notice && <div className="banner ok">{notice}</div>}
      {error && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="card">
            <div className="detail-head">
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 style={{ marginBottom: 6 }}>{data.subject || t("inbox.noSubject")}</h1>
                <div className="row wrap" style={{ gap: "4px 16px", fontSize: 13 }}>
                  <span className="muted">
                    {t("msg.from")} <strong style={{ color: "var(--text)" }}>{senderName(data.headerFrom, data.envelopeFrom)}</strong>
                    <span className="faint addr"> {data.envelopeFrom}</span>
                  </span>
                  <span className="muted">
                    {t("msg.to")} <span className="addr">{data.headerTo || data.aliasAddress}</span>
                  </span>
                </div>
                <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                  {fullTime(data.receivedAt)}
                  {data.aliasLabel ? ` · ${data.aliasLabel}` : ""} {t("msg.arrivedAt", { address: data.aliasAddress })}
                </div>
              </div>
              <div className="row wrap actions-cell">
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

          <AuthBanner verdict={data.authVerdict} auth={data.auth ?? null} />

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

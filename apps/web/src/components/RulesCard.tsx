import { useState } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { relativeTime } from "../lib/format";
import { describeRule, type Rule, type RuleAction, type RuleMatch } from "@mailvault/shared";
import { Menu } from "./ui";

function ruleSummary(r: Rule): string {
  return describeRule(r.match, r.action);
}

/**
 * Rules are deliberately small: match on who sent it or what the subject says, then file
 * it. There is no delete action to choose, because a rule that destroys mail is the one
 * outcome this app promises it will not have.
 */
export function RulesCard() {
  const { data, reload, error } = useAsync(() => api.listRules(), []);
  const [senderDomain, setSenderDomain] = useState("");
  const [subjectContains, setSubjectContains] = useState("");
  const [archive, setArchive] = useState(true);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const rules = data?.items ?? [];
  const nothingToMatch = !senderDomain.trim() && !subjectContains.trim();
  const nothingToDo = !archive && !tag.trim();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const match: RuleMatch = {};
    if (senderDomain.trim()) match.senderDomain = senderDomain.trim().toLowerCase();
    if (subjectContains.trim()) match.subjectContains = subjectContains.trim();
    const action: RuleAction = {};
    if (archive) action.archive = true;
    if (tag.trim()) action.tag = tag.trim();
    try {
      await api.createRule({ match, action });
      setSenderDomain("");
      setSubjectContains("");
      setTag("");
      setArchive(true);
      reload();
    } catch (err) {
      setProblem(err instanceof ApiClientError ? err.message : "Could not create the rule");
    } finally {
      setBusy(false);
    }
  }

  async function drop(r: Rule) {
    setBusy(true);
    try {
      await api.deleteRule(r.id);
      reload();
    } catch (err) {
      setProblem(err instanceof ApiClientError ? err.message : "Could not remove the rule");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(r: Rule) {
    setBusy(true);
    try {
      await api.updateRule(r.id, { enabled: !r.enabled });
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt">
      <h2 style={{ marginTop: 0 }}>Rules</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        New mail that matches is filed for you. Filing takes it out of the inbox list — it
        is still there under <em>Filed</em>, and no rule can delete anything.
      </p>

      {error && <div className="banner error">{error}</div>}
      {problem && <div className="banner error">{problem}</div>}

      {rules.length > 0 && (
        <ul className="msglist" style={{ marginBottom: 12 }}>
          {rules.map((r) => (
            <li key={r.id} className="entity">
              <div className="entity-summary">
                <div className="entity-id">
                  <div className="entity-name">{ruleSummary(r)}</div>
                  <div className="entity-facts">
                    <span>{r.hits} time{r.hits === 1 ? "" : "s"}</span>
                    {r.lastHitAt ? <span>last {relativeTime(r.lastHitAt)}</span> : <span>not used yet</span>}
                    {!r.enabled ? <span className="pill neutral">paused</span> : null}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="ghost small" disabled={busy} onClick={() => toggleEnabled(r)}>
                    {r.enabled ? "Pause" : "Resume"}
                  </button>
                  <Menu small items={[{ label: "Delete rule", danger: true, disabled: busy, onSelect: () => drop(r) }]} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" }}>
          <div className="field">
            <label htmlFor="rule-sender">Sender domain</label>
            <input
              id="rule-sender"
              value={senderDomain}
              onChange={(e) => setSenderDomain(e.target.value)}
              placeholder="newsletters.github.com"
              maxLength={253}
            />
          </div>
          <div className="field">
            <label htmlFor="rule-subject">Subject contains</label>
            <input id="rule-subject" value={subjectContains} onChange={(e) => setSubjectContains(e.target.value)} placeholder="receipt" maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="rule-tag">Tag (optional)</label>
            <input id="rule-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="newsletters" maxLength={60} />
          </div>
        </div>
        <label className="row" style={{ cursor: "pointer", marginTop: 8 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={archive} onChange={(e) => setArchive(e.target.checked)} />
          File it out of the inbox list
        </label>
        <div className="row-end" style={{ marginTop: 10 }}>
          <button type="submit" className="primary" disabled={busy || nothingToMatch || nothingToDo}>
            Add rule
          </button>
          {nothingToMatch && <span className="field-problem">Say what to match on.</span>}
          {nothingToDo && <span className="field-problem">Choose what the rule should do.</span>}
        </div>
      </form>
    </div>
  );
}

/**
 * Senders that hold more than one alias. Judged on the envelope sender, which SPF has to
 * have agreed about, rather than on a `From:` header anyone can type.
 */
export function AddressReuseCard() {
  const { data, error } = useAsync(() => api.addressReuse(), []);
  const items = data?.items ?? [];

  if (error) return null;
  if (items.length === 0) {
    return (
      <div className="card mt">
        <h2 style={{ marginTop: 0 }}>Who holds my addresses</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          No sender has written to more than one of your aliases. Every address is still
          known to exactly one place.
        </p>
      </div>
    );
  }

  return (
    <div className="card mt">
      <h2 style={{ marginTop: 0 }}>Who holds my addresses</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        These senders have mail for more than one alias, so the address was reused or passed
        on. Nothing here is a judgement — it is the list to check when you want to cut one
        of them off.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sender</th>
              <th>Aliases</th>
              <th>Mail</th>
              <th>First seen</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.senderDomain}>
                <td className="addr">{r.senderDomain}</td>
                <td>{r.aliases}</td>
                <td>{r.messages}</td>
                <td className="muted">{relativeTime(r.firstSeen)}</td>
                <td className="muted">{relativeTime(r.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

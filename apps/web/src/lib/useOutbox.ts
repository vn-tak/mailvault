import { useMemo } from "react";
import { api, type OutboxCapabilities } from "./api";
import { useAsync } from "./useAsync";

/**
 * Which of the owner's aliases can sign a message right now.
 *
 * Two questions have to be answered together, and the second one is the reason this is not
 * just a list of aliases: a domain that receives perfectly may still be forbidden to send,
 * because Email Sending is a separate entitlement with its own DNS records. An alias whose
 * domain has not been enabled is a dead end, and offering it in a composer only produces a
 * refusal after the message has been written.
 */
export interface SendableAlias {
  address: string;
  label: string | null;
}

export interface Outbox {
  capabilities: OutboxCapabilities | null;
  aliases: SendableAlias[];
  /** Re-reads the day's remaining budget as well as the aliases. */
  reload: () => void;
}

export function useOutbox(): Outbox {
  const caps = useAsync(() => api.outboxCapabilities(), []);
  const aliasPage = useAsync(() => api.listAliases(), []);

  const aliases = useMemo(() => {
    const sendable = new Set((caps.data?.domains ?? []).filter((d) => d.canSend).map((d) => d.domainId));
    return (aliasPage.data?.items ?? [])
      .filter((a) => a.status === "ACTIVE" && sendable.has(a.domainId))
      .map((a) => ({ address: a.address, label: a.label }));
  }, [aliasPage.data, caps.data]);

  return {
    capabilities: caps.data,
    aliases,
    reload: () => {
      caps.reload();
      aliasPage.reload();
    },
  };
}

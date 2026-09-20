/**
 * The browser half of live inbox updates.
 *
 * One websocket per tab to the owner's hub. The server never sends message content over
 * it — the nudge exists so the tab can go and ask through the normal authenticated API,
 * which is where access control actually lives. Anything that is not the nudge is
 * ignored rather than interpreted.
 */

export const NEW_MAIL_EVENT = "mailvault:new-mail";
const PING_EVERY_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/** Same origin as the page, scheme swapped. No host is ever taken from the wire. */
export function liveUrl(href: string): string {
  const url = new URL(href);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/api/live";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Only `{"type":"new-mail"}` means mail; `hello`, `pong` and anything unparseable do not. */
export function isNewMailMessage(raw: string): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && (parsed as { type?: unknown }).type === "new-mail";
  } catch {
    return false;
  }
}

export interface LiveHandle {
  stop(): void;
}

/**
 * Connect and keep trying. A dropped socket is not an error worth surfacing: the inbox is
 * still correct, it just stops refreshing itself until the next attempt.
 */
export function connectLive(): LiveHandle {
  let closed = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let attempts = 0;

  function open() {
    if (closed) return;
    try {
      socket = new WebSocket(liveUrl(window.location.href));
    } catch {
      schedule();
      return;
    }
    socket.onopen = () => {
      attempts = 0;
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, PING_EVERY_MS);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string" && isNewMailMessage(event.data)) {
        window.dispatchEvent(new Event(NEW_MAIL_EVENT));
      }
    };
    socket.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      schedule();
    };
    socket.onerror = () => socket?.close();
  }

  function schedule() {
    if (closed) return;
    const wait = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempts);
    attempts += 1;
    retry = setTimeout(open, wait);
  }

  open();

  return {
    stop() {
      closed = true;
      if (retry) clearTimeout(retry);
      if (heartbeat) clearInterval(heartbeat);
      socket?.close();
    },
  };
}

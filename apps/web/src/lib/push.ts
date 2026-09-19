import { api } from "./api";

/**
 * Browser notifications. The subscription (endpoint + secrets) is handed to the Worker
 * and never kept in localStorage: the server needs it to push, and the browser would
 * keep it readable forever.
 */

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type PushSupport = "unsupported" | "insecure" | "ready";

export function pushSupport(): PushSupport {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return "ready";
}

export interface PushState {
  support: PushSupport;
  permission: NotificationPermission | "unknown";
  subscribed: boolean;
}

export async function pushState(): Promise<PushState> {
  const support = pushSupport();
  if (support !== "ready") {
    return { support, permission: typeof Notification === "undefined" ? "unknown" : Notification.permission, subscribed: false };
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = await registration?.pushManager.getSubscription();
  return { support, permission: Notification.permission, subscribed: !!sub };
}

/** Ask the browser, subscribe, and register the subscription server-side. */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  if (pushSupport() !== "ready") {
    return { ok: false, message: pushSupport() === "insecure" ? "Notifications need an HTTPS origin." : "This browser cannot receive notifications." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, message: "Notification permission was declined." };

  const { key } = await api.pushPublicKey();
  if (!key) return { ok: false, message: "Push is not configured on this server." };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(key),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    return { ok: false, message: "The browser returned an incomplete subscription." };
  }
  await api.pushSubscribe({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    userAgent: navigator.userAgent.slice(0, 256),
  });
  return { ok: true, message: "You will be notified when new mail arrives." };
}

export async function disablePush(): Promise<{ ok: boolean; message: string }> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return { ok: false, message: "This browser is not subscribed." };
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await api.pushUnsubscribe(endpoint).catch(() => undefined);
  return { ok: true, message: "Notifications turned off for this browser." };
}

import { useEffect, useMemo, useState } from "react";

/**
 * Renders sanitized email HTML inside a `sandbox=""` iframe loaded from a Blob URL.
 * The parent document never contains email markup (section 19); an iframe CSP meta
 * plus the empty sandbox attribute are defense-in-depth on top of the server-side
 * sanitizer. Blob URLs are used (not srcdoc) so the Worker's `frame-src 'self' blob:`
 * policy allows the frame.
 */
export function MessageHtml({ html }: { html: string }) {
  const [url, setUrl] = useState<string | null>(null);

  const doc = useMemo(() => {
    const csp = [
      "default-src 'none'",
      "img-src data: blob: https:",
      "style-src 'unsafe-inline'",
      "font-src data:",
      "sandbox allow-popups",
    ].join("; ");
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>body{font:14px/1.5 system-ui,sans-serif;color:#111;margin:14px;word-break:break-word}a{color:#0a58ca}img{max-width:100%}</style>
</head><body>${html}</body></html>`;
  }, [html]);

  useEffect(() => {
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [doc]);

  if (!url) return <div className="email-frame" />;
  // sandbox="" => no scripts, no same-origin, no forms. allow-popups lets a link
  // (if any survived sanitization) open in a new tab without touching our origin.
  return <iframe className="email-frame" title="Email content" sandbox="" src={url} referrerPolicy="no-referrer" />;
}

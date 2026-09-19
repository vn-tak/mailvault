/** Attachment filenames are attacker-controlled (section 20). We store a *safe*
 *  filename separate from the original: strip directories, control chars, path
 *  traversal, and a restrictive charset, while preserving a reasonable extension.
 *  Download responses use Content-Disposition with this safe name. */

export function sanitizeFilename(input: string, max = 128): string {
  // 1) basename only — drop any path (POSIX or Windows).
  let name = input.replace(/\\/g, "/");
  name = name.slice(name.lastIndexOf("/") + 1);
  // 2) strip control + non-printable.
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, "");
  // 3) separate the extension so we can sanitize the stem and keep a short ext.
  const dot = name.lastIndexOf(".");
  let stem = name;
  let ext = "";
  if (dot > 0 && dot < name.length - 1) {
    stem = name.slice(0, dot);
    ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  }
  // 4) sanitize stem to [A-Za-z0-9._-], collapse runs, trim separators/dots.
  stem = stem.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_{2,}/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, max);
  if (stem.replace(/\.+$/g, "").length === 0) stem = "file";
  // 5) forbid pure-dot names.
  if (/^\.+$/.test(stem)) stem = "file";
  const out = ext ? `${stem}.${ext}` : stem;
  return out.replace(/\.\./g, ".");
}

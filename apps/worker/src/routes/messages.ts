import { Hono } from "hono";
import { z } from "zod";
import { MessageListQuerySchema, ReadFlagSchema, paginated } from "@mailvault/shared";
import type { AppEnv } from "../app-env";
import {
  deleteMessage,
  findAttachment,
  getMessageDetail,
  getMessageRow,
  listMessages,
  setMessageRead,
} from "../db/messages";
import { notFound } from "../lib/errors";
import { log } from "../lib/logging";
import { sanitizeFilename } from "../lib/filename";
import { deleteKeys, getObject } from "../storage/r2";
import { sanitizeEmailHtml } from "../security/sanitize-html";
import { actorOf, parseQuery, readJson } from "./_helpers";

const IdParam = z.object({ id: z.string().min(1) });
const AttachmentParam = z.object({ messageId: z.string().min(1), attachmentId: z.string().min(1) });

/** Shape persisted by the inbound parser at parsed/{messageId}.json (section 12). */
interface ParsedEmail {
  text: string | null;
  html: string | null;
  degraded?: boolean;
}

async function readParsed(bucket: R2Bucket, key: string | null): Promise<ParsedEmail | null> {
  if (!key) return null;
  const obj = await getObject(bucket, key);
  if (!obj) return null;
  try {
    return (await obj.json()) as ParsedEmail;
  } catch {
    return null;
  }
}

export const messagesRoute = new Hono<AppEnv>()
  .get("/api/messages", async (c) => {
    const query = parseQuery(c, MessageListQuerySchema);
    const { items, total } = await listMessages(c.env.DB, query);
    return c.json(paginated(items, { limit: query.limit, offset: query.offset, total }));
  })

  /**
   * Detail view. Bodies come from private R2 parsed content, never from a public
   * source. HTML is server-side sanitized (section 19) and the browser still renders
   * it only inside a sandboxed iframe. Remote images stay blocked unless the owner
   * explicitly asks via ?remoteImages=1.
   */
  .get("/api/messages/:id", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    const detail = await getMessageDetail(c.env.DB, id);
    if (!detail) throw notFound("Message not found");

    const row = await getMessageRow(c.env.DB, id);
    const parsed = await readParsed(c.env.MAIL_BUCKET, row?.parsed_r2_key ?? null);
    const allowRemote = ["1", "true"].includes((c.req.query("remoteImages") ?? "").toLowerCase());

    return c.json({
      ...detail,
      textBody: parsed?.text ?? null,
      htmlBody: parsed?.html ? sanitizeEmailHtml(parsed.html, { allowRemoteImages: allowRemote }) : null,
      parseDegraded: detail.parseDegraded || parsed?.degraded === true,
    });
  })

  .patch("/api/messages/:id/read", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    const { isRead } = await readJson(c, ReadFlagSchema);
    const changed = await setMessageRead(c.env.DB, id, isRead);
    if (changed === 0 && !(await getMessageRow(c.env.DB, id))) throw notFound("Message not found");
    return c.json({ id, isRead });
  })

  /** Delete permanently removes the row plus raw/parsed/attachment R2 objects (section 24). */
  .delete("/api/messages/:id", async (c) => {
    const { id } = IdParam.parse({ id: c.req.param("id") });
    if (!(await getMessageRow(c.env.DB, id))) throw notFound("Message not found");
    const keys = await deleteMessage(c.env.DB, id);
    const removed = await deleteKeys(c.env.MAIL_BUCKET, keys);
    log.info("message_deleted", { actor: actorOf(c).email, messageId: id, r2Attempted: removed.attempted });
    return c.json({ deleted: true, r2ObjectsRemoved: removed.attempted - removed.failed.length });
  })

  /**
   * Authenticated attachment download (section 20/43). Ownership is enforced by the
   * message+attachment FK lookup; the object streams from the private bucket with a
   * safe filename and forced `attachment` disposition so nothing inlines/executes.
   */
  .get("/api/messages/:messageId/attachments/:attachmentId", async (c) => {
    const { messageId, attachmentId } = AttachmentParam.parse({
      messageId: c.req.param("messageId"),
      attachmentId: c.req.param("attachmentId"),
    });
    const att = await findAttachment(c.env.DB, messageId, attachmentId);
    if (!att) throw notFound("Attachment not found");
    const obj = await getObject(c.env.MAIL_BUCKET, att.r2_key);
    if (!obj) throw notFound("Attachment content unavailable");

    const safeName = sanitizeFilename(att.safe_filename || att.filename);
    const headers = new Headers({
      "Content-Type": att.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName.replace(/"/g, "")}"`,
      "Content-Length": String(obj.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return new Response(obj.body, { status: 200, headers });
  });

import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// Helper: extract name and email from "Name <email>" format
function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: from, email: from };
}

// Strip angle brackets from "to" header so Framework7's $h template
// doesn't interpret them as HTML tags (causes VDOM patching errors)
function sanitizeTo(to: string): string {
  return to.replace(/[<>]/g, "");
}

// GET /api/email/accounts/[id]/threads/[threadId]
export const GET = withAccountIdFromParam(
  withEmailProvider("email/thread-detail", async (request, context) => {
    const params = await context.params;
    const threadId = params.threadId;

    const { emailProvider } = request;
    const thread = await emailProvider.getThread(threadId);

    const messages = thread.messages.map((msg) => {
      const { name, email } = parseFrom(msg.headers?.from || "");

      return {
        id: msg.id,
        from_name: name,
        from_email: email,
        to: sanitizeTo(msg.headers?.to || ""),
        cc: sanitizeTo(msg.headers?.cc || ""),
        bcc: sanitizeTo(msg.headers?.bcc || ""),
        replyTo: msg.headers?.["reply-to"] || "",
        date: msg.internalDate
          ? (isNaN(Number(msg.internalDate))
            ? msg.internalDate
            : new Date(Number(msg.internalDate)).toISOString())
          : msg.headers?.date || msg.date || "",
        subject: msg.headers?.subject || "",
        body_html: msg.textHtml || "",
        body_text: msg.textPlain || "",
        snippet: msg.snippet || "",
        headerMessageId: msg.headers?.["message-id"] || msg.id,
        references: msg.headers?.references || "",
        attachments: (msg.attachments || []).map((att) => ({
          id: att.attachmentId,
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
        })),
      };
    });

    return NextResponse.json({ messages });
  }),
);

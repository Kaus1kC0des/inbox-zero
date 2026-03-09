import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/send
export const POST = withAccountIdFromParam(
  withEmailProvider("email/send", async (request) => {
    const { emailProvider, auth } = request;
    const body = await request.json();

    const {
      to,
      cc,
      bcc,
      subject,
      messageHtml,
      replyTo,
      attachments,
    }: {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      messageHtml: string;
      replyTo?: {
        threadId: string;
        headerMessageId: string;
        references?: string;
        messageId?: string;
      };
      attachments?: Array<{
        filename: string;
        content: string;
        contentType: string;
      }>;
    } = body;

    if (!to || !subject) {
      return NextResponse.json(
        { error: "to and subject are required" },
        { status: 400 },
      );
    }

    const result = await emailProvider.sendEmailWithHtml({
      replyToEmail: replyTo,
      to,
      from: auth.email,
      cc,
      bcc,
      subject,
      messageHtml: messageHtml || "",
      attachments,
    });

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      threadId: result.threadId,
    });
  }),
);

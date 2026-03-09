import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// GET /api/email/accounts/[id]/messages/[messageId]/attachment/[attachmentId]
export const GET = withAccountIdFromParam(
  withEmailProvider("email/attachment", async (request, context) => {
    const params = await context.params;
    const { messageId, attachmentId } = params;
    const { emailProvider } = request;

    const attachmentData = await emailProvider.getAttachment(messageId, attachmentId);

    if (!attachmentData.data) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const decodedData = Buffer.from(attachmentData.data, "base64");

    const { searchParams } = new URL(request.url);
    const mimeType = searchParams.get("mimeType") || "application/octet-stream";
    const filename = searchParams.get("filename") || "attachment";

    const headers = new Headers();
    headers.set("Content-Type", mimeType);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    return new NextResponse(decodedData, { headers });
  }),
);

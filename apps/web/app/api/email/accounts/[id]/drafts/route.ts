import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/drafts — create a new draft
export const POST = withAccountIdFromParam(
  withEmailProvider("email/drafts/create", async (request) => {
    const { emailProvider } = request;
    const body = await request.json();

    const {
      to,
      cc,
      bcc,
      subject,
      messageHtml,
    }: {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      messageHtml?: string;
    } = body;

    const result = await emailProvider.createDraft({
      to: to || "",
      subject: subject || "(no subject)",
      messageHtml: messageHtml || "",
    });

    return NextResponse.json({ draftId: result.id });
  }),
);

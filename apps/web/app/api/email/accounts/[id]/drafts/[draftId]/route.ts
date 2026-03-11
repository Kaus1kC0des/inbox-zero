import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// GET /api/email/accounts/[id]/drafts/[draftId] — fetch draft content
export const GET = withAccountIdFromParam(
  withEmailProvider("email/drafts/get", async (request, context) => {
    const { emailProvider } = request;
    const params = await context.params;
    const draftId = params.draftId as string;

    if (!draftId) {
      return NextResponse.json({ error: "draftId required" }, { status: 400 });
    }

    const draft = await emailProvider.getDraft(draftId);

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: draftId,
      to: draft.headers?.to || "",
      cc: draft.headers?.cc || "",
      bcc: draft.headers?.bcc || "",
      subject: draft.headers?.subject || draft.subject || "",
      body: draft.textHtml || draft.textPlain || "",
    });
  }),
);

// PUT /api/email/accounts/[id]/drafts/[draftId] — update draft content
export const PUT = withAccountIdFromParam(
  withEmailProvider("email/drafts/update", async (request, context) => {
    const { emailProvider } = request;
    const params = await context.params;
    const draftId = params.draftId as string;

    if (!draftId) {
      return NextResponse.json({ error: "draftId required" }, { status: 400 });
    }

    const body = await request.json();
    const { subject, messageHtml }: { subject?: string; messageHtml?: string } = body;

    await emailProvider.updateDraft(draftId, { subject, messageHtml });

    return NextResponse.json({ success: true });
  }),
);

// DELETE /api/email/accounts/[id]/drafts/[draftId] — discard draft
export const DELETE = withAccountIdFromParam(
  withEmailProvider("email/drafts/delete", async (request, context) => {
    const { emailProvider } = request;
    const params = await context.params;
    const draftId = params.draftId as string;

    if (!draftId) {
      return NextResponse.json({ error: "draftId required" }, { status: 400 });
    }

    await emailProvider.deleteDraft(draftId);

    return NextResponse.json({ success: true });
  }),
);

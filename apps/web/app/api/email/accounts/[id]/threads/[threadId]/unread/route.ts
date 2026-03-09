import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/threads/[threadId]/unread
export const POST = withAccountIdFromParam(
  withEmailProvider("email/unread", async (request, context) => {
    const params = await context.params;
    const threadId = params.threadId;
    const { emailProvider } = request;

    await emailProvider.markReadThread(threadId, false);

    return NextResponse.json({ success: true });
  }),
);

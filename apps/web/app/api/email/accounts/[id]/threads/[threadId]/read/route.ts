import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/threads/[threadId]/read
export const POST = withAccountIdFromParam(
  withEmailProvider("email/read", async (request, context) => {
    const params = await context.params;
    const threadId = params.threadId;
    const { emailProvider } = request;

    await emailProvider.markReadThread(threadId, true);

    return NextResponse.json({ success: true });
  }),
);

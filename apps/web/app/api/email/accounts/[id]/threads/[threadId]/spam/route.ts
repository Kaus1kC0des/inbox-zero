import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/threads/[threadId]/spam
export const POST = withAccountIdFromParam(
  withEmailProvider("email/spam", async (request, context) => {
    const params = await context.params;
    const threadId = params.threadId;
    const { emailProvider } = request;

    await emailProvider.markSpam(threadId);

    return NextResponse.json({ success: true });
  }),
);

import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/threads/[threadId]/star — toggle star
export const POST = withAccountIdFromParam(
  withEmailProvider("email/star", async (request, context) => {
    const params = await context.params;
    const threadId = params.threadId;
    const { emailProvider } = request;

    await emailProvider.starThread(threadId);

    return NextResponse.json({ success: true });
  }),
);

import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/threads/[threadId]/archive
export const POST = withAccountIdFromParam(
  withEmailProvider("email/archive", async (request, context) => {
    const params = await context.params;
    const threadId = params.threadId;
    const { emailProvider, auth } = request;

    await emailProvider.archiveThread(threadId, auth.email);

    return NextResponse.json({ success: true });
  }),
);

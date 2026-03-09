import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// POST /api/email/accounts/[id]/threads/[threadId]/trash
export const POST = withAccountIdFromParam(
  withEmailProvider("email/trash", async (request, context) => {
    const params = await context.params;
    const threadId = params.threadId;
    const { emailProvider, auth } = request;

    await emailProvider.trashThread(threadId, auth.email, "user");

    return NextResponse.json({ success: true });
  }),
);

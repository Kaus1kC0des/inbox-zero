import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";

// DELETE /api/email/accounts/[id] — disconnect (unlink) an email account
export const DELETE = withAuth("email/accounts/disconnect", async (request, context) => {
  const params = await context.params;
  const emailAccountId = params.id as string;
  const userId = BigInt(request.auth.userId);

  // Verify this account belongs to the authenticated user
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { userId: true, accountId: true },
  });

  if (!emailAccount || emailAccount.userId !== userId) {
    return NextResponse.json({ error: "Not found", isKnownError: true }, { status: 404 });
  }

  // Delete the Account row — cascades to EmailAccount via onDelete: Cascade
  await prisma.account.delete({ where: { id: emailAccount.accountId } });

  return NextResponse.json({ success: true });
});

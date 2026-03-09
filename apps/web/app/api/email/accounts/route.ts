import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";

// GET /api/email/accounts — list connected email accounts for the user
export const GET = withAuth("email/accounts", async (request) => {
  const userId = BigInt(request.auth.userId);

  const emailAccounts = await prisma.emailAccount.findMany({
    where: { userId },
    include: {
      account: {
        select: { provider: true },
      },
    },
  });

  const accounts = emailAccounts.map((ea) => ({
    id: ea.id,
    provider: ea.account.provider,
    email: ea.email,
    name: ea.name,
    image: ea.image,
  }));

  return NextResponse.json({ accounts });
});

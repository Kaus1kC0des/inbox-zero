import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { ensureEmailAccountsWatched } from "@/utils/email/watch-manager";

export const GET = withAuth("watch", async (request) => {
  const userId = request.auth.userId;
  console.log("[api/watch] Called for userId:", userId);

  const emailAccountCount = await prisma.emailAccount.count({
    where: { userId },
  });
  console.log("[api/watch] emailAccountCount:", emailAccountCount);

  if (emailAccountCount === 0) {
    return NextResponse.json(
      { message: "No email accounts found for this user." },
      { status: 404 },
    );
  }

  try {
    const results = await ensureEmailAccountsWatched({
      userIds: [userId],
      logger: request.logger,
    });
    console.log("[api/watch] results:", JSON.stringify(results));
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[api/watch] ERROR:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
});

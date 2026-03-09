import "server-only";
import prisma from "@/utils/prisma";

/**
 * Validate that an account belongs to a user
 * @param userId The user ID
 * @param emailAccountId The account ID to validate
 * @returns email address of the account if it belongs to the user, otherwise null
 */
export async function getEmailAccount({
  userId,
  emailAccountId,
}: {
  userId: string;
  emailAccountId: string;
}): Promise<string | null> {
  if (!userId || !emailAccountId) return null;

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId, userId: BigInt(userId) },
    select: { email: true },
  });

  return emailAccount?.email ?? null;
}

/**
 * Invalidate the cached validation result for a user's account
 * No-op without Redis
 */
export async function invalidateAccountValidation(_params: {
  userId: string;
  emailAccountId: string;
}): Promise<void> {
  // No-op — no Redis cache
}

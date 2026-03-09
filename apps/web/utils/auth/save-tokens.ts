import prisma from "@/utils/prisma";
import { encryptToken } from "@/utils/encryption";
import { createScopedLogger } from "@/utils/logger";
import { captureException } from "@/utils/error";

const logger = createScopedLogger("save-tokens");

/**
 * Save refreshed OAuth tokens back to the database.
 * Called by Gmail/Outlook clients after token refresh.
 */
export async function saveTokens({
  tokens,
  accountRefreshToken,
  providerAccountId,
  emailAccountId,
  provider,
}: {
  tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
  accountRefreshToken: string | null;
  provider: string;
} & (
  | { providerAccountId: string; emailAccountId?: never }
  | { emailAccountId: string; providerAccountId?: never }
)) {
  const refreshToken = tokens.refresh_token ?? accountRefreshToken;

  if (!refreshToken) {
    logger.error("Attempted to save null refresh token", { providerAccountId });
    captureException("Cannot save null refresh token", {
      extra: { providerAccountId },
    });
    return;
  }

  const data = {
    access_token: tokens.access_token,
    expires_at: tokens.expires_at ? new Date(tokens.expires_at * 1000) : null,
    refresh_token: refreshToken,
    disconnectedAt: null,
  };

  if (emailAccountId) {
    // Encrypt tokens manually (prisma-extensions handles account-level updates)
    if (data.access_token)
      data.access_token = encryptToken(data.access_token) || undefined;
    if (data.refresh_token)
      data.refresh_token = encryptToken(data.refresh_token) || "";

    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { account: { update: data } },
      select: { userId: true },
    });
  } else {
    if (!providerAccountId) {
      logger.error("No providerAccountId found", { emailAccountId });
      captureException("No providerAccountId found", {
        extra: { emailAccountId },
      });
      return;
    }

    await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      data,
    });
  }
}

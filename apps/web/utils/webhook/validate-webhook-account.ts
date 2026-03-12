import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { logErrorWithDedupe } from "@/utils/log-error-with-dedupe";
import type { Prisma } from "@/generated/prisma/client";

// Only select fields that actually exist in our EmailAccount schema
const webhookEmailAccountSelect = {
  id: true,
  email: true,
  userId: true,
  timezone: true,
  lastSyncedHistoryId: true,
  watchEmailsSubscriptionId: true,
  account: {
    select: {
      provider: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
      disconnectedAt: true,
    },
  },
  user: {
    select: {
      id: true,
    },
  },
} satisfies Prisma.EmailAccountSelect;

type WebhookEmailAccount = Prisma.EmailAccountGetPayload<{
  select: typeof webhookEmailAccountSelect;
}>;

export async function getWebhookEmailAccount(
  where: { email: string } | { watchEmailsSubscriptionId: string },
  logger: Logger,
) {
  let emailAccount: WebhookEmailAccount | null = null;

  if ("email" in where) {
    emailAccount = await prisma.emailAccount.findUnique({
      where: { email: where.email },
      select: webhookEmailAccountSelect,
    });
  } else {
    // Outlook subscription lookup
    emailAccount = await prisma.emailAccount.findFirst({
      where: { watchEmailsSubscriptionId: where.watchEmailsSubscriptionId },
      select: webhookEmailAccountSelect,
    });
  }

  if (!emailAccount) {
    await logErrorWithDedupe({
      logger,
      message: "Account not found",
      context: {
        hasSubscriptionIdLookup: "watchEmailsSubscriptionId" in where,
      },
      dedupeKeyParts: {
        scope: "webhook/account-validation",
        email: "email" in where ? where.email : null,
        watchEmailsSubscriptionId:
          "watchEmailsSubscriptionId" in where
            ? where.watchEmailsSubscriptionId
            : null,
        lookupType:
          "watchEmailsSubscriptionId" in where ? "subscription" : "email",
      },
      ttlSeconds: 10 * 60,
      summaryIntervalSeconds: 2 * 60,
    });
  }

  return emailAccount;
}

export type ValidatedWebhookAccountData = Awaited<
  ReturnType<typeof getWebhookEmailAccount>
>;

export type ValidatedWebhookAccount = {
  emailAccount: NonNullable<ValidatedWebhookAccountData>;
  hasAutomationRules: boolean;
  hasAiAccess: boolean;
};

type ValidationResult =
  | { success: true; data: ValidatedWebhookAccount }
  | { success: false; response: NextResponse };

export async function validateWebhookAccount(
  emailAccount: ValidatedWebhookAccountData | null,
  logger: Logger,
): Promise<ValidationResult> {
  if (!emailAccount) {
    return { success: false, response: NextResponse.json({ ok: true }) };
  }

  if (emailAccount.account?.disconnectedAt) {
    logger.info("Skipping disconnected account");
    return { success: false, response: NextResponse.json({ ok: true }) };
  }

  if (
    !emailAccount.account?.access_token ||
    !emailAccount.account?.refresh_token
  ) {
    logger.error("Missing access or refresh token");
    return { success: false, response: NextResponse.json({ ok: true }) };
  }

  logger.info("Webhook account validated", { email: emailAccount.email });

  return {
    success: true,
    data: {
      emailAccount,
      // We don't use AI rules in QikOffice but keep these flags for compatibility
      hasAutomationRules: false,
      hasAiAccess: true,
    },
  };
}

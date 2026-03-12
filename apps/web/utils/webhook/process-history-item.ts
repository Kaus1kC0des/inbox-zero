// Simplified shared processor — QikOffice email client only (no AI/rules/filing).
// Full AI processing (rules, categorization, filing) has been stripped.
// When AI features are needed, restore from git history.

import { isIgnoredSender } from "@/utils/filter-ignored-senders";
import type { EmailProvider } from "@/utils/email/types";
import type { ParsedMessage, RuleWithActions } from "@/utils/types";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { Logger } from "@/utils/logger";

function notifySocketService({
  userId,
  emailAccountId,
  threadId,
  from,
  subject,
  snippet,
  date,
}: {
  userId: string;
  emailAccountId: string;
  threadId: string | undefined;
  from: string;
  subject: string;
  snippet: string;
  date: string | null | undefined;
}) {
  const url = process.env.SOCKET_SERVICE_URL;
  const key = process.env.SOCKET_SERVER_KEY;
  if (!url || !key) return;
  fetch(`${url}/internal/email-notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({
      userId,
      emailAccountId,
      threadId,
      from,
      subject,
      snippet,
      date,
    }),
  }).catch((e) => console.error("email-notify fetch failed", e));
}

export type SharedProcessHistoryOptions = {
  provider: EmailProvider;
  rules: RuleWithActions[];
  hasAutomationRules: boolean;
  hasAiAccess: boolean;
  emailAccount: EmailAccountWithAI;
  logger: Logger;
};

export async function processHistoryItem(
  {
    messageId,
    threadId,
    message,
  }: {
    messageId: string;
    threadId?: string;
    message?: ParsedMessage;
  },
  options: SharedProcessHistoryOptions,
) {
  const { provider, emailAccount, logger } = options;

  const emailAccountId = emailAccount.id;
  const userEmail = emailAccount.email;

  try {
    logger.info("Shared processor started");

    // Fetch message if not pre-provided
    const parsedMessage = message ?? (await provider.getMessage(messageId));

    if (isIgnoredSender(parsedMessage.headers.from)) {
      logger.info("Skipping. Ignored sender.");
      return;
    }

    const actualThreadId = threadId || parsedMessage.threadId;

    // Skip outbound (sent) messages — only notify for inbound
    const isOutbound =
      parsedMessage.headers.from
        ?.toLowerCase()
        .includes(userEmail.toLowerCase()) ||
      (parsedMessage.labelIds?.includes("SENT") &&
        !parsedMessage.labelIds?.includes("INBOX"));

    if (isOutbound) {
      logger.info("Skipping outbound message");
      return;
    }

    logger.info("Inbound message — notifying socket service");

    // Notify the QikOffice socket service so the frontend shows real-time update
    notifySocketService({
      userId: emailAccount.userId.toString(),
      emailAccountId,
      threadId: actualThreadId,
      from: parsedMessage.headers.from,
      subject: parsedMessage.subject || "(no subject)",
      snippet: parsedMessage.snippet || "",
      date: parsedMessage.headers.date,
    });
  } catch (error) {
    logger.error("Error processing message", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

import type { Prisma } from "@/generated/prisma/client";

export type UserAIFields = {
  aiProvider?: string | null;
  aiModel?: string | null;
  aiApiKey?: string | null;
};

export type EmailAccountWithAI = Prisma.EmailAccountGetPayload<{
  select: {
    id: true;
    userId: true;
    email: true;
    timezone: true;
    account: {
      select: {
        provider: true;
      };
    };
  };
}> & {
  // These fields exist in the original inbox-zero schema but not ours.
  // Typed as optional so downstream AI code doesn't crash — values will be undefined.
  about?: string | null;
  multiRuleSelectionEnabled?: boolean | null;
  calendarBookingLink?: string | null;
  user?: UserAIFields | null;
};

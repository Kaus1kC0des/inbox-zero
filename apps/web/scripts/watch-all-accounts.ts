// Run with:
//   cd apps/web
//   NODE_ENV=development npx tsx --require dotenv/config scripts/watch-all-accounts.ts
// Registers Gmail/Outlook watch() for all connected accounts (run once for existing users)

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScopedLogger } from "@/utils/logger";
import { ensureEmailAccountsWatched } from "@/utils/email/watch-manager";

const adapter = new PrismaPg({
  connectionString:
    process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });
const logger = createScopedLogger("watch-all-accounts");

async function main() {
  console.log("Registering watch for all connected email accounts...");
  const results = await ensureEmailAccountsWatched({
    userIds: null,
    logger,
  });

  const succeeded = results.filter((r) => r.status === "success");
  const failed = results.filter((r) => r.status === "error");

  console.log(`\nDone. Success: ${succeeded.length}, Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed accounts:");
    for (const f of failed) {
      console.log(
        `  - ${f.emailAccountId}: ${(f as { message: string }).message}`,
      );
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { encryptedTokens } from "@/utils/prisma-extensions";

declare global {
  var prisma: PrismaClient | undefined;
}

const databaseUrl = process.env.DATABASE_URL || "";

// PrismaMariaDb factory takes a connection string (mysql:// or mariadb://)
const adapter = new PrismaMariaDb(databaseUrl);

const _prisma =
  global.prisma ||
  (new PrismaClient({ adapter }).$extends(
    encryptedTokens,
  ) as unknown as PrismaClient);

if (process.env.NODE_ENV === "development") global.prisma = _prisma;

export default _prisma;

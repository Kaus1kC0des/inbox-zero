import "server-only";
import prisma from "@/utils/prisma";

interface QikOfficeUser {
  id: string; // BigInt user_id, stringified for inbox-zero compatibility
  email: string;
  name: string | null;
}

/**
 * Validate a QikOffice access token against the user_access table.
 * Returns the user if valid, null otherwise.
 */
export async function validateQikOfficeToken(
  token: string | null,
): Promise<QikOfficeUser | null> {
  if (!token) return null;

  try {
    // Query user_access + user tables via raw SQL (user_access is not in Prisma schema)
    const result = await prisma.$queryRawUnsafe<
      Array<{ user_id: bigint; email: string; name: string | null }>
    >(
      `SELECT u.user_id, u.email, u.name
       FROM user u
       JOIN user_access ua ON u.user_id = ua.user_id
       WHERE ua.access_token = ?
         AND u.is_active = 1
         AND u.is_deleted = 0
       LIMIT 1`,
      token,
    );

    if (!result || result.length === 0) return null;

    const row = result[0];
    return {
      id: row.user_id.toString(),
      email: row.email,
      name: row.name,
    };
  } catch {
    return null;
  }
}

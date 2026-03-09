import { env } from "@/env";
import prisma from "@/utils/prisma";
import { getLinkingOAuth2Client } from "@/utils/gmail/client";
import { GOOGLE_LINKING_STATE_COOKIE_NAME } from "@/utils/gmail/constants";
import { withError } from "@/utils/middleware";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { SafeError } from "@/utils/error";

function oauthResultHtml(success: boolean, email?: string, error?: string) {
  const messageObj = success
    ? { type: "email_oauth_success", provider: "google", email }
    : { type: "email_oauth_error", error };

  return new Response(
    `<!DOCTYPE html><html><body><script>
      if (window.opener) { window.opener.postMessage(${JSON.stringify(messageObj)}, '*'); }
      window.close();
    </script><p>${success ? "Success! This window will close." : `Error: ${error || "Unknown"}`}</p></body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Cross-Origin-Opener-Policy": "unsafe-none",
      },
    },
  );
}

export const GET = withError("google/linking/callback", async (request) => {
  const logger = request.logger;

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const receivedState = searchParams.get("state");

  if (!code) {
    return oauthResultHtml(false, undefined, "Missing authorization code");
  }

  if (!receivedState) {
    return oauthResultHtml(false, undefined, "Missing state parameter");
  }

  let targetUserId: string;
  try {
    const decoded = JSON.parse(
      Buffer.from(receivedState, "base64url").toString("utf8"),
    );
    targetUserId = decoded.userId;
    if (!targetUserId) throw new Error("No userId in state");
  } catch {
    return oauthResultHtml(false, undefined, "Invalid state parameter");
  }

  const googleAuth = getLinkingOAuth2Client();

  try {
    const { tokens } = await googleAuth.getToken(code);
    const { id_token } = tokens;

    if (!id_token) throw new SafeError("Missing id_token from Google response");

    const ticket = await googleAuth.verifyIdToken({
      idToken: id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new SafeError("Could not get payload from ID token");

    const providerAccountId = payload.sub;
    const providerEmail = payload.email;

    if (!providerAccountId || !providerEmail) {
      throw new SafeError("ID token missing subject or email");
    }

    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: { provider: "google", providerAccountId },
      },
      select: { id: true, userId: true },
    });

    if (existingAccount) {
      await prisma.account.update({
        where: { id: existingAccount.id },
        data: {
          access_token: tokens.access_token,
          ...(tokens.refresh_token != null && {
            refresh_token: tokens.refresh_token,
          }),
          expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          scope: tokens.scope,
          token_type: tokens.token_type,
          id_token: tokens.id_token,
        },
      });
      logger.info("Updated tokens for existing Google account", {
        email: providerEmail,
        accountId: existingAccount.id,
      });
    } else {
      try {
        await prisma.account.create({
          data: {
            userId: BigInt(targetUserId),
            type: "oidc",
            provider: "google",
            providerAccountId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: tokens.expiry_date
              ? new Date(tokens.expiry_date)
              : null,
            scope: tokens.scope,
            token_type: tokens.token_type,
            id_token: tokens.id_token,
            emailAccount: {
              create: {
                email: providerEmail,
                userId: BigInt(targetUserId),
                name: payload.name || null,
                image: payload.picture,
              },
            },
          },
        });
        logger.info("Created new Google account", {
          email: providerEmail,
          targetUserId,
        });
      } catch (createError: unknown) {
        if (isDuplicateError(createError)) {
          logger.info("Account already exists (race), updating tokens", {
            providerAccountId,
          });
          await prisma.account.update({
            where: {
              provider_providerAccountId: {
                provider: "google",
                providerAccountId,
              },
            },
            data: {
              access_token: tokens.access_token,
              ...(tokens.refresh_token != null && {
                refresh_token: tokens.refresh_token,
              }),
              expires_at: tokens.expiry_date
                ? new Date(tokens.expiry_date)
                : null,
            },
          });
        } else {
          throw createError;
        }
      }
    }

    const response = oauthResultHtml(true, providerEmail);
    response.headers.set(
      "Set-Cookie",
      `${GOOGLE_LINKING_STATE_COOKIE_NAME}=; Path=/; Max-Age=0`,
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Google OAuth callback error", { error });
    return oauthResultHtml(false, undefined, message);
  }
});

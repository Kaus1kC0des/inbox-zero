import { env } from "@/env";
import prisma from "@/utils/prisma";
import { OUTLOOK_LINKING_STATE_COOKIE_NAME } from "@/utils/outlook/constants";
import { withError } from "@/utils/middleware";
import { SafeError } from "@/utils/error";
import { isDuplicateError } from "@/utils/prisma-helpers";

function oauthResultHtml(success: boolean, email?: string, error?: string) {
  const messageObj = success
    ? { type: "email_oauth_success", provider: "microsoft", email }
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

export const GET = withError("outlook/linking/callback", async (request) => {
  const logger = request.logger;

  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET)
    return oauthResultHtml(false, undefined, "Microsoft login not enabled");

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const receivedState = searchParams.get("state");

  if (!code)
    return oauthResultHtml(false, undefined, "Missing authorization code");
  if (!receivedState)
    return oauthResultHtml(false, undefined, "Missing state parameter");

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

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.MICROSOFT_CLIENT_ID,
          client_secret: env.MICROSOFT_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${env.NEXT_PUBLIC_BASE_URL}/api/outlook/linking/callback`,
        }),
      },
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new SafeError(
        tokens.error_description || "Failed to exchange code for tokens",
      );
    }

    // Get user profile
    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileResponse.ok)
      throw new SafeError("Failed to fetch user profile");

    const profile = await profileResponse.json();
    const providerAccountId = profile.id;
    const providerEmail = profile.mail || profile.userPrincipalName;

    if (!providerAccountId || !providerEmail)
      throw new SafeError("Profile missing required id or email");

    // Optionally fetch profile photo
    let profileImage: string | null = null;
    try {
      const photoResponse = await fetch(
        "https://graph.microsoft.com/v1.0/me/photo/$value",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (photoResponse.ok) {
        const photoBuffer = await photoResponse.arrayBuffer();
        profileImage = `data:image/jpeg;base64,${Buffer.from(photoBuffer).toString("base64")}`;
      }
    } catch (e) {
      logger.warn("Failed to fetch profile picture", { error: e });
    }

    const expiresAt = tokens.expires_in
      ? new Date(
          Date.now() + Number.parseInt(String(tokens.expires_in), 10) * 1000,
        )
      : null;

    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "microsoft",
          providerAccountId,
        },
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
          expires_at: expiresAt,
          scope: tokens.scope,
          token_type: tokens.token_type,
          disconnectedAt: null,
        },
      });
      logger.info("Updated tokens for existing Microsoft account", {
        email: providerEmail,
      });
    } else {
      try {
        await prisma.account.create({
          data: {
            userId: BigInt(targetUserId),
            type: "oidc",
            provider: "microsoft",
            providerAccountId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: expiresAt,
            scope: tokens.scope,
            token_type: tokens.token_type,
            emailAccount: {
              create: {
                email: providerEmail,
                userId: BigInt(targetUserId),
                name:
                  profile.displayName ||
                  profile.givenName ||
                  profile.surname ||
                  null,
                image: profileImage,
              },
            },
          },
        });
        logger.info("Created new Microsoft account", {
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
                provider: "microsoft",
                providerAccountId,
              },
            },
            data: {
              access_token: tokens.access_token,
              ...(tokens.refresh_token != null && {
                refresh_token: tokens.refresh_token,
              }),
              expires_at: expiresAt,
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
      `${OUTLOOK_LINKING_STATE_COOKIE_NAME}=; Path=/; Max-Age=0`,
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Outlook OAuth callback error", { error });
    return oauthResultHtml(false, undefined, message);
  }
});

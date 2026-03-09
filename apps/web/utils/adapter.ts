import { NextRequest } from "next/server";
import { EMAIL_ACCOUNT_HEADER } from "@/utils/config";
import type { NextHandler } from "@/utils/middleware";

/**
 * Wraps a Next.js route handler to inject the X-Email-Account-ID header
 * from the `[id]` URL param. This bridges the adapter route pattern
 * (/email/accounts/[id]/...) with inbox-zero's header-based middleware.
 */
export function withAccountIdFromParam(handler: NextHandler): NextHandler {
  return async (req, context) => {
    const params = await context.params;
    const accountId = params.id;

    if (accountId) {
      // Clone headers and add the email account ID
      const headers = new Headers(req.headers);
      headers.set(EMAIL_ACCOUNT_HEADER, accountId);
      const modifiedReq = new NextRequest(req.url, {
        method: req.method,
        headers,
        body: req.body,
      });
      return handler(modifiedReq, context);
    }

    return handler(req, context);
  };
}

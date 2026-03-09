import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";

// GET /api/email/accounts/[id]/labels
export const GET = withAccountIdFromParam(
  withEmailProvider("email/labels", async (request) => {
    const { emailProvider } = request;

    const labels = await emailProvider.getLabels();

    return NextResponse.json({
      labels: labels.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
      })),
    });
  }),
);

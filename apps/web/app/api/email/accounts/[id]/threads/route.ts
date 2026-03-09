import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { withAccountIdFromParam } from "@/utils/adapter";
import type { ParsedMessage } from "@/utils/types";

// Helper: extract name and email from "Name <email>" format
function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: from, email: from };
}

// Helper: map inbox-zero thread to frontend shape
function mapThread(thread: { id: string; messages: ParsedMessage[]; snippet: string }) {
  const lastMsg = thread.messages[thread.messages.length - 1];
  const firstMsg = thread.messages[0];
  const { name, email } = parseFrom(firstMsg?.headers?.from || "");

  return {
    id: thread.id,
    from_name: name,
    from_email: email,
    subject: firstMsg?.headers?.subject || firstMsg?.subject || "",
    snippet: thread.snippet || lastMsg?.snippet || "",
    date: lastMsg?.internalDate
      ? new Date(Number(lastMsg.internalDate)).toISOString()
      : lastMsg?.headers?.date || lastMsg?.date || "",
    is_read: !lastMsg?.labelIds?.includes("UNREAD"),
    message_count: thread.messages.length,
  };
}

// GET /api/email/accounts/[id]/threads
export const GET = withAccountIdFromParam(
  withEmailProvider("email/threads", async (request, context) => {
    const { emailProvider } = request;
    const { searchParams } = new URL(request.url);

    const limit = Number(searchParams.get("limit")) || 30;
    const folder = searchParams.get("folder") || "inbox";
    const q = searchParams.get("q") || undefined;
    const pageToken = searchParams.get("pageToken") || undefined;

    // Map folder names to inbox-zero query type
    const typeMap: Record<string, string> = {
      inbox: "inbox",
      sent: "sent",
      drafts: "draft",
    };

    const { threads, nextPageToken } = await emailProvider.getThreadsWithQuery({
      query: {
        type: typeMap[folder] || "inbox",
        q,
      },
      maxResults: limit,
      pageToken,
    });

    return NextResponse.json({
      threads: threads.map(mapThread),
      nextPageToken: nextPageToken || null,
    });
  }),
);

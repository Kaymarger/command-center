import { NextResponse } from "next/server";
import { listGmailOutbox, markGmailOutbox } from "@/lib/gmail-outbox";
import { requireUserOrBot, requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireUserSession();
  if (denied) return denied;

  const items = await listGmailOutbox();
  return NextResponse.json({ items });
}

/** Mark an outbox item after an external Gmail draft/send succeeds. */
export async function PATCH(request: Request) {
  const denied = await requireUserOrBot(request);
  if (denied) return denied;

  const body = (await request.json()) as {
    id?: string;
    status?: "drafted" | "sent" | "error" | "pending";
    gmailId?: string;
    viewUrl?: string;
    error?: string;
  };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const item = await markGmailOutbox(body.id, {
    status: body.status,
    gmailId: body.gmailId,
    viewUrl: body.viewUrl,
    error: body.error,
  });
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

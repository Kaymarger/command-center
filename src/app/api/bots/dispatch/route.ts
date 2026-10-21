import { connection, NextResponse } from "next/server";
import { dispatchToBot, type DispatchInput } from "@/lib/bots/runtime";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  await connection();
  const denied = await requireUserSession();
  if (denied) return denied;

  const body = (await request.json()) as DispatchInput;

  if (!body?.actionId || !body?.actionLabel || !body?.summary) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const job = await dispatchToBot(body);
  return NextResponse.json({ job });
}

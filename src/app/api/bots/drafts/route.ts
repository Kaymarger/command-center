import { NextResponse } from "next/server";
import { awaitStoreReady, listDrafts } from "@/lib/bot-store";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireUserSession();
  if (denied) return denied;

  await awaitStoreReady();
  return NextResponse.json({ drafts: listDrafts() });
}

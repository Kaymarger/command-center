import { NextResponse } from "next/server";
import {
  ensureFeedLoop,
  reloadFeedsFromDisk,
} from "@/lib/bot-store";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireUserSession();
  if (denied) return denied;

  ensureFeedLoop();
  const feeds = await reloadFeedsFromDisk();
  return NextResponse.json(feeds, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  const denied = await requireUserSession();
  if (denied) return denied;

  const feeds = await reloadFeedsFromDisk();
  return NextResponse.json(feeds);
}

import { NextResponse } from "next/server";
import { setFeeds } from "@/lib/bot-store";
import { syncFeedsFromGoogleSheet } from "@/lib/sheet-sync";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await requireUserSession();
  if (denied) return denied;

  try {
    const synced = await syncFeedsFromGoogleSheet();
    await setFeeds(synced.feeds);
    return NextResponse.json({
      ok: true,
      feeds: synced.feeds,
      cardErrors: synced.cardErrors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 400 }
    );
  }
}

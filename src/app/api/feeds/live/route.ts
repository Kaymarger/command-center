import { connection, NextResponse } from "next/server";
import { loadDashboardFeeds } from "@/lib/sheet-sync";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await connection();
  const denied = await requireUserSession();
  if (denied) return denied;

  const payload = await loadDashboardFeeds();
  return NextResponse.json(
    {
      ...payload.feeds,
      sheetError: payload.sheetError,
      openHouseError: payload.openHouseError,
      cardErrors: payload.cardErrors,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST() {
  await connection();
  const denied = await requireUserSession();
  if (denied) return denied;

  const payload = await loadDashboardFeeds();
  return NextResponse.json({
    ...payload.feeds,
    sheetError: payload.sheetError,
    openHouseError: payload.openHouseError,
    cardErrors: payload.cardErrors,
  });
}

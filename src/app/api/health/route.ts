import { connection, NextResponse } from "next/server";
import { requireUserSession } from "@/lib/ops-guard";
import { dashboardHealth, loadDashboardFeeds } from "@/lib/sheet-sync";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

/**
 * Signed-in tab check. Row counts and errors only — no names, addresses, or dates.
 * Each card that looks empty can be matched to the tab it reads.
 */
export async function GET() {
  await connection();
  const denied = await requireUserSession();
  if (denied) return denied;

  await loadDashboardFeeds();
  const report = dashboardHealth();
  return NextResponse.json(report ?? { error: "The dashboard has not read the sheets yet." }, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

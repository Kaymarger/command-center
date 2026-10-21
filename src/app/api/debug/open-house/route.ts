import { connection, NextResponse } from "next/server";
import { debugOpenHouse } from "@/lib/sheet-sync";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

/**
 * Temporary signed-in check for the open-house sheet.
 * Returns row counts and errors only — no names, dates, or notes.
 */
export async function GET() {
  await connection();
  const denied = await requireUserSession();
  if (denied) return denied;

  const report = await debugOpenHouse();
  return NextResponse.json(report, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

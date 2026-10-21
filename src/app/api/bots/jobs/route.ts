import { NextResponse } from "next/server";
import { ensureFeedLoop, listJobs } from "@/lib/bot-store";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireUserSession();
  if (denied) return denied;

  ensureFeedLoop();
  return NextResponse.json({ jobs: listJobs() });
}

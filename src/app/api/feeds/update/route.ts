import { NextResponse } from "next/server";
import { setFeeds } from "@/lib/bot-store";
import type { LiveFeeds } from "@/lib/dashboard-data";
import { emptyOpsCards, summarizeOpenHouses } from "@/lib/dashboard-data";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const denied = await requireUserSession();
  if (denied) return denied;

  const body = (await request.json()) as Partial<LiveFeeds>;

  const feeds: LiveFeeds = {
    updatedAt: new Date().toISOString(),
    source: "webhook",
    cincAgents: body.cincAgents ?? [],
    anniversaries: body.anniversaries ?? [],
    birthdays: body.birthdays ?? [],
    referrals: body.referrals ?? { active: [], history: [] },
    outstandingEmails: body.outstandingEmails ?? [],
    opsCards: body.opsCards ?? emptyOpsCards(),
    openHouse: {
      rows: body.openHouse?.rows ?? [],
      summary:
        body.openHouse?.summary ||
        summarizeOpenHouses(body.openHouse?.rows ?? []),
    },
  };

  await setFeeds(feeds);
  return NextResponse.json({ ok: true, feeds });
}

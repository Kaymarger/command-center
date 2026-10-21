import { NextResponse } from "next/server";
import { getFeeds, setFeeds } from "@/lib/bot-store";
import { mergeWebhookFeeds, readFeedsFile } from "@/lib/feeds-io";
import type { LiveFeeds } from "@/lib/dashboard-data";
import { requireUserOrBot } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ bot: string }>;
};

export async function POST(request: Request, { params }: PageProps) {
  const denied = await requireUserOrBot(request);
  if (denied) return denied;

  const { bot } = await params;
  const body = (await request.json()) as Partial<LiveFeeds> & {
    cincAgents?: LiveFeeds["cincAgents"];
    anniversaries?: LiveFeeds["anniversaries"];
    birthdays?: LiveFeeds["birthdays"];
    referrals?: LiveFeeds["referrals"];
    openHouse?: LiveFeeds["openHouse"];
    outstandingEmails?: LiveFeeds["outstandingEmails"];
  };

  const current = getFeeds().source === "empty" ? await readFeedsFile() : getFeeds();
  let patch: Partial<LiveFeeds> = {};

  if (bot === "cinc" && body.cincAgents) {
    patch = { cincAgents: body.cincAgents };
  } else if (bot === "work-routine") {
    patch = {
      anniversaries: body.anniversaries,
      birthdays: body.birthdays,
      referrals: body.referrals,
    };
  } else if (bot === "google-forms" && body.openHouse) {
    patch = { openHouse: body.openHouse };
  } else if (body.outstandingEmails) {
    patch = { outstandingEmails: body.outstandingEmails };
  } else {
    patch = body;
  }

  const next = mergeWebhookFeeds(current, patch);
  await setFeeds(next);
  return NextResponse.json({ ok: true, bot, feeds: next });
}

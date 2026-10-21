import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Radio } from "lucide-react";
import { bots, type BotId } from "@/lib/dashboard-data";
import { BotLivePanel } from "@/components/bot-live-panel";

type PageProps = {
  params: Promise<{ bot: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { bot } = await params;
  const info = bots[bot as BotId];
  return { title: info?.label ?? "Bot" };
}

export default async function BotPage({ params }: PageProps) {
  const { bot } = await params;
  const info = bots[bot as BotId];
  if (!info) notFound();

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-[#7395B8] transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Dashboard
      </Link>

      <div className="mb-4 inline-flex items-center gap-2 text-xs text-[#7395B8]">
        <Radio className="size-3.5" />
        Live bot runtime
      </div>

      <h1 className="font-heading text-[clamp(1.75rem,4vw,2.5rem)] font-medium tracking-tight text-foreground">
        {info.label}
      </h1>
      <p className="mt-3 text-muted-foreground">{info.description}</p>

      <BotLivePanel botId={info.id} botLabel={info.label} />
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BotId } from "@/lib/dashboard-data";
import type { BotJob } from "@/lib/bot-store";
import { Button } from "@/components/ui/button";

type BotLivePanelProps = {
  botId: BotId;
  botLabel: string;
};

export function BotLivePanel({ botId, botLabel }: BotLivePanelProps) {
  const [jobs, setJobs] = useState<BotJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function loadJobs() {
    const res = await fetch("/api/bots/jobs", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { jobs: BotJob[] };
    setJobs(data.jobs.slice(0, 12));
  }

  useEffect(() => {
    void loadJobs();
    const id = window.setInterval(() => void loadJobs(), 4000);
    return () => window.clearInterval(id);
  }, []);

  async function refreshFeeds() {
    setRefreshing(true);
    try {
      await fetch("/api/feeds/live", { method: "POST" });
      await loadJobs();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mt-8 grid gap-4">
      <div className="rounded-2xl border border-[#7395B8]/30 bg-white/[0.06] p-5 backdrop-blur-xl">
        <p className="text-sm leading-relaxed text-muted-foreground">
          You enter work in the command center; {botLabel} receives the job at
          its webhook. Each bot needs its webhook address (
          <code className="text-foreground/90">BOT_*_URL</code>) and key (
          <code className="text-foreground/90">BOT_*_KEY</code>). A missing
          email address does not block sending.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void refreshFeeds()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Force feed refresh"}
          </Button>
          <Link
            href="/dashboard"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition hover:bg-muted"
          >
            Open dashboard
          </Link>
        </div>
        <p className="mt-3 text-xs text-[#7395B8]">Feed key: {botId}</p>
      </div>

      <div className="rounded-2xl border border-[#7395B8]/30 bg-white/[0.06] p-5 backdrop-blur-xl">
        <h2 className="mb-3 font-heading text-lg text-foreground">Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No jobs yet. Run an action from the command center.
          </p>
        ) : (
          <ul className="grid gap-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{job.actionLabel}</p>
                  <span
                    className={
                      job.webhookDelivery?.status === "sent"
                        ? "text-xs uppercase tracking-[0.12em] text-emerald-300"
                        : job.webhookDelivery?.status === "failed"
                          ? "text-xs uppercase tracking-[0.12em] text-red-300"
                          : job.webhookDelivery?.status === "not_configured"
                            ? "text-xs uppercase tracking-[0.12em] text-amber-200"
                            : "text-xs uppercase tracking-[0.12em] text-[#7395B8]"
                    }
                  >
                    {job.webhookDelivery?.status === "sent"
                      ? "Sent to bot"
                      : job.webhookDelivery?.status === "failed"
                        ? "Send failed"
                        : job.webhookDelivery?.status === "not_configured"
                          ? "Not linked"
                          : job.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{job.summary}</p>
                {job.result ? (
                  <p className="mt-1 text-xs text-foreground/80">{job.result}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

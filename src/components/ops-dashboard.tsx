"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Mail, X } from "lucide-react";
import { artifactKindLabel, type BotArtifact } from "@/lib/artifacts";
import { bots, type BotId } from "@/lib/dashboard-data";
import { useLiveFeeds } from "@/hooks/use-live-feeds";
import { DashboardNotepad } from "@/components/dashboard-notepad";
import { cn } from "@/lib/utils";

function ArtifactList({
  items,
  empty,
}: {
  items: BotArtifact[];
  empty: string;
}) {
  if (items.length === 0) {
    return <EmptyTile message={empty} />;
  }
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <span className="shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-[#7395B8]">
              {item.status}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {item.detail}
          </p>
          <p className="mt-1 text-[0.65rem] text-[#7395B8]/90">
            {artifactKindLabel(item.kind)}
            {item.property ? ` · ${item.property}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

const SKIPPED_KEY = "areg-ops-skipped-emails";

function EmptyTile({ message }: { message: string }) {
  return (
    <p className="flex h-full items-center justify-center px-2 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}

function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-[#7395B8]">
      <span className="relative flex size-1.5">
        {live ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/80" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-1.5 rounded-full",
            live ? "bg-emerald-400" : "bg-muted-foreground"
          )}
        />
      </span>
      {live ? "Live" : "Offline"}
    </span>
  );
}

function BotSourceLink({ botId }: { botId: BotId }) {
  const bot = bots[botId];
  return (
    <Link
      href={bot.href}
      className="inline-flex shrink-0 items-center gap-0.5 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-[#7395B8] transition hover:text-foreground"
      title={`Open ${bot.label}`}
    >
      {bot.label}
      <ArrowUpRight className="size-3" />
    </Link>
  );
}

function Tile({
  title,
  botId,
  live,
  children,
  className,
}: {
  title: string;
  botId?: BotId;
  live?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex aspect-[12/7] min-h-[9rem] flex-col overflow-hidden rounded-2xl border border-[#7395B8]/30 bg-white/[0.06] p-3.5 backdrop-blur-xl sm:min-h-0",
        className
      )}
    >
      <div className="mb-2 flex shrink-0 flex-wrap items-start justify-between gap-2">
        <h2 className="font-heading text-base tracking-tight text-foreground sm:text-lg">
          {title}
        </h2>
        <div className="flex flex-col items-end gap-1">
          {botId ? <BotSourceLink botId={botId} /> : null}
          {typeof live === "boolean" ? <LiveDot live={live} /> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">{children}</div>
    </section>
  );
}

export function OpsDashboard() {
  const { feeds, drafts, jobs, artifacts, live, error } = useLiveFeeds();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [cincPeriod, setCincPeriod] = useState<"wtd" | "mtd" | "ytd">("wtd");
  const [updatedLabel, setUpdatedLabel] = useState<string>("—");
  const recentJobs = jobs.slice(0, 8);
  const deals = artifacts.filter((a) => a.kind === "deal" || a.kind === "listing").slice(0, 8);
  const documents = artifacts.filter((a) => a.kind === "document").slice(0, 8);
  const docusign = artifacts.filter((a) => a.kind === "docusign").slice(0, 8);
  const chatOutbox = artifacts.filter((a) => a.kind === "chat").slice(0, 8);
  const socialQueue = artifacts
    .filter((a) => a.kind === "social" || a.kind === "feature-sheet")
    .slice(0, 8);

  useEffect(() => {
    try {
      setSkipped(
        new Set(
          JSON.parse(window.localStorage.getItem(SKIPPED_KEY) ?? "[]") as string[]
        )
      );
    } catch {
      setSkipped(new Set());
    }
  }, []);

  useEffect(() => {
    setUpdatedLabel(
      new Date(feeds.updatedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }, [feeds.updatedAt]);

  const emails = (feeds.outstandingEmails ?? []).filter(
    (email) => !skipped.has(email.id)
  );

  function skipEmail(id: string) {
    setSkipped((prev) => {
      const next = new Set(prev);
      next.add(id);
      window.localStorage.setItem(SKIPPED_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <Link
        href="/"
        className="mb-5 inline-flex w-fit items-center gap-1.5 text-sm text-[#7395B8] transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Command center
      </Link>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[clamp(1.6rem,3.5vw,2.25rem)] font-medium tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter work in the command center · bots complete it · {live ? "live" : "offline"} ·{" "}
            {updatedLabel}
          </p>
          {error ? (
            <p className="mt-1 max-w-xl text-xs text-red-300">{error}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/jobs"
            className="inline-flex h-8 items-center rounded-lg border border-[#7395B8]/40 px-3 text-xs font-medium text-[#7395B8] transition hover:border-[#7395B8]/70 hover:text-foreground"
          >
            Job inbox
          </Link>
          <Link
            href="/dashboard/data"
            className="inline-flex h-8 items-center rounded-lg bg-[#1F6598] px-3 text-xs font-medium text-white transition hover:bg-[#1F6598]/85"
          >
            Edit live data
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Tile title="Sent to bots" live={live}>
          {recentJobs.length === 0 ? (
            <EmptyTile message="Jobs you enter in the command center show up here after they’re sent to bots." />
          ) : (
            <ul className="grid gap-2">
              {recentJobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {job.actionLabel}
                    </p>
                    <span
                      className={
                        job.webhookDelivery?.status === "sent"
                          ? "shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-emerald-300"
                          : job.webhookDelivery?.status === "failed"
                            ? "shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-red-300"
                            : job.webhookDelivery?.status === "not_configured"
                              ? "shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-amber-200"
                              : "shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-[#7395B8]"
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
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {job.result || job.summary}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile title="Draft Email">
          {drafts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Mail className="size-7 text-[#7395B8]/80" />
              <p className="text-sm text-muted-foreground">
                Conveyancing / Generate Email drafts appear here after the bot completes them.
              </p>
            </div>
          ) : (
            <ul className="grid gap-2">
              {drafts.map((item) => {
                const open = expandedDraft === item.id;
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() =>
                        setExpandedDraft(open ? null : item.id)
                      }
                    >
                      <p className="text-sm font-medium text-foreground">
                        {item.draftEmail?.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        To {item.draftEmail?.to} ·{" "}
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </button>
                    {open ? (
                      <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2.5 text-xs leading-relaxed text-foreground/90">
                        {item.draftEmail?.body}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Tile>

        <Tile title="Pipeline">
          <ArtifactList
            items={deals}
            empty="Listings, offers, accepted/firm/subject removal land here after you send them to bots."
          />
        </Tile>

        <Tile title="Documents">
          <ArtifactList
            items={documents}
            empty="Generate Document requests appear here when the transaction bot completes them."
          />
        </Tile>

        <Tile title="DocuSign">
          <ArtifactList
            items={docusign}
            empty="Send via DocuSign packs show here once queued for signature."
          />
        </Tile>

        <Tile title="AREG Chat outbox">
          <ArtifactList
            items={chatOutbox}
            empty="Message AREG Chat entries queue here for Work Routine bot delivery."
          />
        </Tile>

        <Tile title="Marketing queue">
          <ArtifactList
            items={socialQueue}
            empty="Social Media and Feature Sheet jobs land here for listings bot."
          />
        </Tile>

        <Tile title="Important Dates">
          <DashboardNotepad
            storageKey="areg-ops-important-dates"
            placeholder="Dump dates however you like — Apr 22 Okada anniversary, 5/4 listing expires…"
          />
        </Tile>

        <Tile title="To-Do's">
          <DashboardNotepad
            storageKey="areg-ops-todos"
            placeholder="Brain-dump tasks — follow up Bennett, print feature sheets, book photographer…"
          />
        </Tile>

        <Tile title="Outstanding Emails">
          {emails.length === 0 ? (
            <EmptyTile message="No outstanding emails in the live sheet." />
          ) : (
            <ul className="grid gap-2">
              {emails.map((email) => (
                <li
                  key={email.id}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {email.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {email.detail}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => skipEmail(email.id)}
                      className="shrink-0 rounded-md px-1.5 py-1 text-[0.7rem] text-[#7395B8] transition hover:bg-white/10 hover:text-foreground"
                      title="Skip notification"
                    >
                      <span className="inline-flex items-center gap-1">
                        <X className="size-3" />
                        Skip
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile title="Open House Availability" botId="google-forms" live={live}>
          {(feeds.openHouse?.rows ?? []).length === 0 ? (
            <EmptyTile message="Open houses you send from the command center land here; Forms bot can add more." />
          ) : (
            <>
              {feeds.openHouse?.summary ? (
                <p className="mb-3 rounded-xl border border-[#1F6598]/35 bg-[#1F6598]/15 px-3 py-2.5 text-xs leading-relaxed text-foreground/90">
                  {feeds.openHouse.summary}
                </p>
              ) : null}
              <ul className="grid gap-1.5 text-xs">
                {(feeds.openHouse?.rows ?? []).map((row, index) => (
                  <li
                    key={`${row.agent}-${row.coverage}-${row.window}-${index}`}
                    className="flex items-start justify-between gap-2 border-b border-white/5 py-1.5 last:border-0"
                  >
                    <span>
                      <span className="font-medium text-foreground">
                        {row.agent}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {row.window}
                      </span>
                    </span>
                    <span className="shrink-0 text-[#7395B8]">{row.coverage}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Tile>

        <Tile title="Referral Exchange" botId="work-routine" live={live}>
          {(feeds.referrals?.active ?? []).length === 0 &&
          (feeds.referrals?.history ?? []).length === 0 ? (
            <EmptyTile message="Waiting for Work Routine bot / Referrals sheet rows." />
          ) : (
            <>
              <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#7395B8]">
                Currently on
              </p>
              <ul className="mb-3 grid gap-1.5">
                {(feeds.referrals?.active ?? []).map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg bg-black/20 px-2.5 py-2 text-xs"
                  >
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-muted-foreground">
                      {item.direction} · {item.meta}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#7395B8]">
                History
              </p>
              <ul className="grid gap-1.5">
                {(feeds.referrals?.history ?? []).map((item) => (
                  <li key={item.id} className="text-xs text-muted-foreground">
                    <span className="text-foreground/90">{item.name}</span>
                    <span className="mt-0.5 block">
                      {item.direction} · {item.meta}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Tile>

        <Tile title="CINC Call History" botId="cinc" live={live}>
          {(feeds.cincAgents ?? []).length === 0 ? (
            <EmptyTile message="Waiting for CINC bot / CINC sheet rows." />
          ) : (
            <>
              <div className="mb-2 flex gap-1">
                {(
                  [
                    ["wtd", "WTD"],
                    ["mtd", "MTD"],
                    ["ytd", "YTD"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCincPeriod(id)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] transition",
                      cincPeriod === id
                        ? "bg-[#1F6598]/45 text-foreground"
                        : "text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ul className="grid gap-2">
                {(feeds.cincAgents ?? []).map((agent) => {
                  const stats = agent[cincPeriod];
                  return (
                    <li
                      key={agent.id}
                      className="rounded-xl border border-white/10 bg-black/20 px-2.5 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {agent.agent}
                        </p>
                        <p className="text-[0.7rem] text-muted-foreground">
                          Last call · {agent.lastCall}
                        </p>
                      </div>
                      <div className="mt-2 flex justify-between gap-2 text-[0.7rem] text-muted-foreground">
                        <span>
                          <span className="block text-base font-medium text-foreground">
                            {stats.calls}
                          </span>
                          Calls
                        </span>
                        <span>
                          <span className="block text-base font-medium text-foreground">
                            {stats.connected}
                          </span>
                          Connected
                        </span>
                        <span>
                          <span className="block text-base font-medium text-foreground">
                            {stats.appointments}
                          </span>
                          Appts
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Tile>

        <Tile title="Client Anniversaries" botId="work-routine" live={live}>
          {(feeds.anniversaries ?? []).length === 0 ? (
            <EmptyTile message="Waiting for Work Routine bot / Anniversaries sheet." />
          ) : (
            <ul className="grid gap-2">
              {(feeds.anniversaries ?? []).map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 border-b border-white/5 pb-2 text-sm last:border-0"
                >
                  <span>
                    <span className="font-medium text-foreground">{item.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.note}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[#7395B8]">
                    {item.date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile title="Client Birthdays" botId="work-routine" live={live}>
          {(feeds.birthdays ?? []).length === 0 ? (
            <EmptyTile message="Waiting for Work Routine bot / Birthdays sheet." />
          ) : (
            <ul className="grid gap-2">
              {(feeds.birthdays ?? []).map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 border-b border-white/5 pb-2 text-sm last:border-0"
                >
                  <span>
                    <span className="font-medium text-foreground">{item.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.note}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[#7395B8]">
                    {item.date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>
    </div>
  );
}

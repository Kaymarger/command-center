"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { botLabel } from "@/lib/ops-actions";
import type { BotJob } from "@/lib/bot-store";
import {
  bots,
  type BotId,
  type CincAgentStats,
  type CincGroup,
  type OpsCardItem,
} from "@/lib/dashboard-data";
import { useLiveFeeds } from "@/hooks/use-live-feeds";
import { DashboardNotepad } from "@/components/dashboard-notepad";
import { TenantNoticeCalculator } from "@/components/tenant-notice-calculator";
import { cn } from "@/lib/utils";

function MiniButton({
  children,
  disabled,
  onClick,
  title,
  label,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-[#7395B8] transition hover:border-[#7395B8]/60 hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function CompactRow({
  text,
  detail,
  expanded,
  onToggle,
  children,
}: {
  text: string;
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20">
      <div className="flex items-center gap-1 px-1.5 py-0.5">
        <button
          type="button"
          title={detail || text}
          onClick={onToggle}
          className="min-w-0 flex-1 truncate text-left text-xs text-foreground"
        >
          {text}
        </button>
        {children}
      </div>
      {expanded && detail ? (
        <p className="whitespace-pre-wrap border-t border-white/10 px-1.5 py-1 text-[0.7rem] leading-snug text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function SheetLines({
  items,
  expandedId,
  onToggle,
  hidden,
  errors,
  renderActions,
}: {
  items: OpsCardItem[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  hidden: Set<string>;
  errors?: Record<string, string>;
  renderActions?: (item: OpsCardItem) => ReactNode;
}) {
  const visible = items.filter((item) => !hidden.has(item.id));
  if (visible.length === 0) return null;
  return (
    <ul className="grid gap-1">
      {visible.map((item) => (
        <li key={item.id}>
          <CompactRow
            text={item.busy && !item.text.endsWith("· sending") ? `${item.text} · sending` : item.text}
            detail={item.detail || item.text}
            expanded={expandedId === item.id}
            onToggle={() => onToggle(item.id)}
          >
            {renderActions?.(item)}
          </CompactRow>
          {errors?.[item.id] ? (
            <p className="px-1 pt-0.5 text-[0.65rem] text-amber-200">{errors[item.id]}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OpsSheetCard({
  title,
  items,
  empty,
  note,
  live,
  botId,
  comingUp,
  extra,
  expandedId,
  onToggle,
  hidden,
  errors,
  renderActions,
}: {
  title: string;
  items: OpsCardItem[];
  empty: string;
  note?: string;
  live?: boolean;
  botId?: BotId;
  comingUp?: boolean;
  extra?: ReactNode;
  expandedId: string | null;
  onToggle: (id: string) => void;
  hidden: Set<string>;
  errors?: Record<string, string>;
  renderActions?: (item: OpsCardItem) => ReactNode;
}) {
  const visible = items.filter((item) => !hidden.has(item.id));
  const due = visible.filter((item) => item.section !== "upcoming");
  const upcoming = visible.filter((item) => item.section === "upcoming");
  const showEmpty = due.length === 0 && upcoming.length === 0 && !note;
  return (
    <Tile title={title} live={live} botId={botId}>
      {extra}
      {note ? <div className="mb-1"><SheetProblem message={note} /></div> : null}
      {showEmpty ? <EmptyTile message={empty} /> : null}
      {due.length > 0 ? (
        <SheetLines items={due} expandedId={expandedId} onToggle={onToggle} hidden={hidden} errors={errors} renderActions={renderActions} />
      ) : null}
      {upcoming.length > 0 ? (
        <div className={due.length > 0 ? "mt-2" : undefined}>
          {comingUp ? (
            <p className="mb-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[#7395B8]">
              Coming up
            </p>
          ) : null}
          <SheetLines items={upcoming} expandedId={expandedId} onToggle={onToggle} hidden={hidden} errors={errors} renderActions={renderActions} />
        </div>
      ) : null}
    </Tile>
  );
}

function EmptyTile({ message }: { message: string }) {
  return (
    <p className="flex h-full items-center justify-center px-1 text-center text-xs text-muted-foreground">
      {message}
    </p>
  );
}

function SheetProblem({ message }: { message: string }) {
  return <p className="text-xs leading-relaxed text-amber-200">{message}</p>;
}

function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[0.6rem] font-medium uppercase tracking-[0.12em] text-[#7395B8]">
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
      className="inline-flex shrink-0 items-center gap-0.5 text-[0.6rem] font-medium uppercase tracking-[0.12em] text-[#7395B8] transition hover:text-foreground"
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
        "flex max-h-[7.25rem] min-h-[3.75rem] flex-col overflow-hidden rounded-xl border border-[#7395B8]/30 bg-white/[0.06] p-1.5 backdrop-blur-xl",
        className
      )}
    >
      <div className="mb-0.5 flex shrink-0 flex-wrap items-start justify-between gap-1">
        <h2 className="font-heading text-xs tracking-tight text-foreground">
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

function cincCounts(stats: CincAgentStats["wtd"]): CincGroup["week"] {
  return [
    { label: "calls", value: stats.calls },
    { label: "connects", value: stats.connected },
    { label: "appts", value: stats.appointments },
  ];
}

function cincGroupsFor(groups: CincGroup[] | undefined, agents: CincAgentStats[] | undefined): CincGroup[] {
  if (groups?.length) return groups;
  return (agents ?? []).map((agent) => ({
    agent: agent.agent,
    today: [],
    week: cincCounts(agent.wtd),
    year: cincCounts(agent.ytd),
  }));
}

function cincLine(counts: CincGroup["week"]): string {
  if (!counts.length) return "No counts";
  return counts.map((count) => `${count.value} ${count.label}`).join(" · ");
}

export function OpsDashboard() {
  const {
    feeds,
    jobs,
    live,
    error,
    sheetError,
    openHouseError,
    cardErrors,
  } = useLiveFeeds();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cincPeriod, setCincPeriod] = useState<"today" | "week" | "year">("week");
  const [updatedLabel, setUpdatedLabel] = useState<string>("—");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [jobOverride, setJobOverride] = useState<Record<string, BotJob>>({});
  const [queuedDrafts, setQueuedDrafts] = useState<Set<string>>(() => new Set());
  const [sendingIds, setSendingIds] = useState<Set<string>>(() => new Set());
  const [addingTodo, setAddingTodo] = useState(false);
  const [todoDraft, setTodoDraft] = useState({
    dueDate: "",
    item: "",
    address: "",
    ownerBot: "",
  });
  const [addingOpenHouse, setAddingOpenHouse] = useState(false);
  const [openHouseDraft, setOpenHouseDraft] = useState({
    address: "",
    date: "",
    startTime: "",
    endTime: "",
    hostAgent: "",
    notes: "",
  });
  const recentJobs = jobs.slice(0, 8).map((job) => {
    const override = jobOverride[job.id];
    if (override && override.updatedAt >= job.updatedAt) return override;
    return job;
  });
  const emailDraftLines = (feeds.sheetEmailDrafts ?? []).slice(0, 10);

  useEffect(() => {
    setUpdatedLabel(
      new Date(feeds.updatedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }, [feeds.updatedAt]);

  const opsCards = feeds.opsCards;
  const opsNotes = feeds.opsCardNotes ?? {};
  const cincGroups = cincGroupsFor(feeds.cincGroups, feeds.cincAgents);

  function toggle(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  async function postAction(id: string, body: Record<string, unknown>) {
    setPendingId(id);
    setActionError((current) => ({ ...current, [id]: "" }));
    try {
      const res = await fetch("/api/dashboard/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; job?: BotJob };
      if (!res.ok || !data.ok) throw new Error(data.error || "That did not work.");
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "That did not work.";
      setActionError((current) => ({ ...current, [id]: message }));
      return null;
    } finally {
      setPendingId(null);
    }
  }

  async function skipSheetItem(item: OpsCardItem) {
    if (!item.sheet || !item.skipValue) return;
    const data = await postAction(item.id, {
      type: "skip-cell",
      itemId: item.id,
      spreadsheet: item.sheet.spreadsheet,
      tab: item.sheet.tab,
      row: item.sheet.row,
      column: item.sheet.column,
      value: item.skipValue,
    });
    if (data) setHiddenIds((current) => new Set(current).add(item.id));
  }

  async function sendOutstanding(item: OpsCardItem) {
    if (!item.sheet || !item.draftId) return;
    const address = item.text.split("·")[0]?.trim() ?? item.text;
    if (!window.confirm(`Send this email for ${address}? It will be queued to the Transaction Bot.`)) {
      return;
    }
    const data = await postAction(item.id, {
      type: "send-outstanding",
      itemId: item.id,
      draftId: item.draftId,
      address,
      emailType: item.detail ?? "",
      row: item.sheet.row,
      column: item.sheet.column,
    });
    if (data) setSendingIds((current) => new Set(current).add(item.id));
  }

  async function controlJob(job: BotJob, command: "pause" | "cancel") {
    const data = await postAction(job.id, { type: "job-control", jobId: job.id, command });
    if (data?.job) setJobOverride((current) => ({ ...current, [job.id]: data.job as BotJob }));
  }

  async function skipDraft(job: BotJob) {
    const data = await postAction(job.id, { type: "draft-skip", jobId: job.id });
    if (data) setHiddenIds((current) => new Set(current).add(job.id));
  }

  async function sendDraft(job: BotJob) {
    const subject = job.draftEmail?.subject || "this draft";
    if (!window.confirm(`Send “${subject}” through the ${botLabel(job.bot)}?`)) return;
    const data = await postAction(job.id, { type: "draft-send", jobId: job.id });
    if (data) setQueuedDrafts((current) => new Set(current).add(job.id));
  }

  async function sendSheetDraft(item: OpsCardItem) {
    const botName = item.bot ? botLabel(item.bot as BotJob["bot"]) : "its bot";
    if (!window.confirm(`Send “${item.text}” through the ${botName}?`)) return;
    const to = item.detail?.match(/^To\s+([^\n]+)/)?.[1]?.trim() ?? "";
    const data = await postAction(item.id, {
      type: "sheet-draft-send",
      itemId: item.id,
      bot: item.bot ?? "",
      subject: item.text,
      to,
      bodyText: item.detail ?? "",
      tab: item.sheet?.tab,
      row: item.sheet?.row,
      column: item.sheet?.column,
    });
    if (data) setHiddenIds((current) => new Set(current).add(item.id));
  }

  async function skipSheetDraft(item: OpsCardItem) {
    if (!item.sheet) return;
    const data = await postAction(item.id, {
      type: "sheet-draft-skip",
      itemId: item.id,
      tab: item.sheet.tab,
      row: item.sheet.row,
      column: item.sheet.column,
    });
    if (data) setHiddenIds((current) => new Set(current).add(item.id));
  }

  async function queueDocusign(item: OpsCardItem, command: "send" | "delete") {
    const verb = command === "send" ? "Send" : "Delete";
    if (!window.confirm(`${verb} “${item.text}”?`)) return;
    const data = await postAction(item.id, {
      type: command === "send" ? "docusign-send" : "docusign-delete",
      itemId: item.id,
      bot: item.bot ?? "",
      text: item.text,
      address: item.detail ?? "",
      detail: item.detail ?? "",
      tab: item.sheet?.tab,
      row: item.sheet?.row,
      column: item.sheet?.column,
    });
    if (data) setHiddenIds((current) => new Set(current).add(item.id));
  }

  async function changeOpenHouse(item: OpsCardItem, command: "cancel" | "delete") {
    const verb = command === "delete" ? "Delete" : "Cancel";
    if (!window.confirm(`${verb} “${item.text}”? The Listings Bot will be told.`)) return;
    const data = await postAction(item.id, {
      type: command === "delete" ? "delete-open-house" : "cancel-open-house",
      itemId: item.id,
      text: item.text,
      address: item.text,
      detail: item.detail ?? "",
      tab: item.sheet?.tab,
      row: item.sheet?.row,
      column: item.sheet?.column,
    });
    if (data) setHiddenIds((current) => new Set(current).add(item.id));
  }

  async function addOpenHouse(event: FormEvent) {
    event.preventDefault();
    const data = await postAction("add-open-house", {
      type: "add-open-house",
      address: openHouseDraft.address,
      date: openHouseDraft.date,
      startTime: openHouseDraft.startTime,
      endTime: openHouseDraft.endTime,
      hostAgent: openHouseDraft.hostAgent,
      notes: openHouseDraft.notes,
    });
    if (data) {
      setOpenHouseDraft({ address: "", date: "", startTime: "", endTime: "", hostAgent: "", notes: "" });
      setAddingOpenHouse(false);
    }
  }

  async function addTodo(event: FormEvent) {
    event.preventDefault();
    const data = await postAction("add-todo", {
      type: "add-todo",
      dueDate: todoDraft.dueDate,
      item: todoDraft.item,
      address: todoDraft.address,
      ownerBot: todoDraft.ownerBot,
    });
    if (data) {
      setTodoDraft({ dueDate: "", item: "", address: "", ownerBot: "" });
      setAddingTodo(false);
    }
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
            Enter work in the command center · Bots complete it · {live ? "live" : "offline"} ·{" "}
            {updatedLabel}
          </p>
          {error ? (
            <p className="mt-1 max-w-xl text-xs text-red-300">{error}</p>
          ) : null}
          {sheetError ? (
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-amber-200">
              {sheetError}
            </p>
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <Tile title="Sent to Bots" live={live}>
          {recentJobs.length === 0 ? (
            <EmptyTile message="Jobs you enter in the command center show up here after they’re sent to Bots." />
          ) : (
            <ul className="grid gap-1">
              {recentJobs.map((job) => {
                const status =
                  job.status === "paused"
                    ? "Paused"
                    : job.status === "cancelled"
                      ? "Cancelled"
                      : job.webhookDelivery?.status === "sent"
                        ? "Sent to Bot"
                        : job.webhookDelivery?.status === "failed"
                          ? "Send failed"
                          : job.webhookDelivery?.status === "not_configured"
                            ? "Not linked"
                            : job.status;
                return (
                  <li key={job.id}>
                    <CompactRow
                      text={job.actionLabel}
                      detail={job.result || job.summary}
                      expanded={expandedId === job.id}
                      onToggle={() => toggle(job.id)}
                    >
                      <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.08em] text-[#7395B8]">
                        {status}
                      </span>
                      {job.status !== "cancelled" ? (
                        <>
                          <MiniButton
                            disabled={pendingId === job.id || job.status === "paused"}
                            onClick={() => void controlJob(job, "pause")}
                          >
                            Pause
                          </MiniButton>
                          <MiniButton
                            disabled={pendingId === job.id}
                            onClick={() => void controlJob(job, "cancel")}
                          >
                            Cancel
                          </MiniButton>
                        </>
                      ) : null}
                    </CompactRow>
                    {actionError[job.id] ? (
                      <p className="px-1 pt-0.5 text-[0.65rem] text-amber-200">{actionError[job.id]}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Tile>

        <OpsSheetCard
          title="To-Do's"
          live={live}
          items={opsCards?.todos ?? []}
          note={opsNotes.todos}
          empty="No to-dos."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
          errors={actionError}
          extra={
            <>
              {addingTodo ? (
              <form className="mb-1 grid gap-1" onSubmit={(event) => void addTodo(event)}>
                <input
                  type="date"
                  value={todoDraft.dueDate}
                  onChange={(event) => setTodoDraft((current) => ({ ...current, dueDate: event.target.value }))}
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="Due date"
                />
                <input
                  value={todoDraft.item}
                  onChange={(event) => setTodoDraft((current) => ({ ...current, item: event.target.value }))}
                  placeholder="To-do"
                  required
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="To-do"
                />
                <input
                  value={todoDraft.address}
                  onChange={(event) => setTodoDraft((current) => ({ ...current, address: event.target.value }))}
                  placeholder="Address"
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="Address"
                />
                <select
                  value={todoDraft.ownerBot}
                  onChange={(event) => setTodoDraft((current) => ({ ...current, ownerBot: event.target.value }))}
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="Owner bot"
                >
                  <option value="">Owner bot</option>
                  <option value="transaction">Transaction</option>
                  <option value="listings">Listings</option>
                  <option value="manager">Manager</option>
                  <option value="work-routine">Work Routine</option>
                </select>
                <div className="flex gap-1">
                  <button
                    type="submit"
                    disabled={pendingId === "add-todo"}
                    className="rounded border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-[#7395B8]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingTodo(false)}
                    className="rounded border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-[#7395B8]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="mb-1">
                <MiniButton label="Add to-do" onClick={() => setAddingTodo(true)}>Add</MiniButton>
              </div>
            )}
            </>
          }
          renderActions={(item) =>
            item.sheet ? (
              <MiniButton disabled={pendingId === item.id} onClick={() => void skipSheetItem(item)}>
                Skip
              </MiniButton>
            ) : null
          }
        />

        <OpsSheetCard
          title="Outstanding Emails"
          live={live}
          comingUp
          items={(opsCards?.outstandingEmails ?? []).map((item) =>
            sendingIds.has(item.id)
              ? {
                  ...item,
                  busy: true,
                  draftId: undefined,
                }
              : item,
          )}
          note={opsNotes.outstandingEmails}
          empty="No firm, completion, review, or pre-completion emails due today or earlier."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
          errors={actionError}
          renderActions={(item) =>
            item.busy ? null : (
              <>
                <MiniButton
                  disabled={pendingId === item.id || !item.draftId}
                  title={item.draftId ? "Queue this draft to the Transaction Bot" : "No draft id on this row"}
                  onClick={() => void sendOutstanding(item)}
                >
                  Send
                </MiniButton>
                <MiniButton disabled={pendingId === item.id || !item.sheet} onClick={() => void skipSheetItem(item)}>
                  Skip
                </MiniButton>
              </>
            )
          }
        />

        <Tile title="Email Drafts">
          {feeds.emailDraftNote ? (
            <div className="mb-0.5">
              <SheetProblem message={feeds.emailDraftNote} />
            </div>
          ) : null}
          {emailDraftLines.length === 0 ? (
            <p className="text-xs text-muted-foreground">No email drafts.</p>
          ) : (
            <ul className="grid gap-0.5">
              {emailDraftLines.map((item) => (
                <li key={item.id} title={item.detail || item.text} className="truncate text-xs text-foreground">
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noreferrer" className="hover:underline">
                      {item.text}
                    </a>
                  ) : (
                    item.text
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile title="Marketing Queue">
          {opsNotes.googleBusiness ? (
            <div className="mb-0.5">
              <SheetProblem message={opsNotes.googleBusiness} />
            </div>
          ) : null}
          {(opsCards?.googleBusiness ?? []).length === 0 ? (
            <EmptyTile message="Nothing scheduled." />
          ) : (
            <SheetLines
              items={opsCards?.googleBusiness ?? []}
              expandedId={expandedId}
              onToggle={toggle}
              hidden={hiddenIds}
            />
          )}
        </Tile>

        <Tile title="Important Dates">
          <DashboardNotepad
            storageKey="areg-ops-important-dates"
            draft={feeds.importantDatesDraft ?? ""}
            placeholder="Apr 22 Okada anniversary, 5/4 listing expires…"
            onSave={async (text) => {
              try {
                const res = await fetch("/api/dashboard/action", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ type: "save-important-dates", text }),
                });
                const data = (await res.json()) as { ok?: boolean; error?: string };
                if (!res.ok || !data.ok) {
                  return { ok: false, message: data.error || "That did not save." };
                }
                return { ok: true, message: "" };
              } catch (err) {
                return { ok: false, message: err instanceof Error ? err.message : "That did not save." };
              }
            }}
          />
        </Tile>

        <OpsSheetCard
          title="Open Houses"
          live={live}
          items={opsCards?.scheduledOpenHouses ?? []}
          note={opsNotes.scheduledOpenHouses}
          empty="No upcoming open houses."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
          errors={actionError}
          extra={
            addingOpenHouse ? (
              <form className="mb-1 grid gap-1" onSubmit={(event) => void addOpenHouse(event)}>
                <input
                  value={openHouseDraft.address}
                  onChange={(event) => setOpenHouseDraft((current) => ({ ...current, address: event.target.value }))}
                  placeholder="Address"
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="Open house address"
                />
                <input
                  type="date"
                  value={openHouseDraft.date}
                  onChange={(event) => setOpenHouseDraft((current) => ({ ...current, date: event.target.value }))}
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="Open house date"
                />
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="time"
                    value={openHouseDraft.startTime}
                    onChange={(event) => setOpenHouseDraft((current) => ({ ...current, startTime: event.target.value }))}
                    className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                    aria-label="Start time"
                  />
                  <input
                    type="time"
                    value={openHouseDraft.endTime}
                    onChange={(event) => setOpenHouseDraft((current) => ({ ...current, endTime: event.target.value }))}
                    className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                    aria-label="End time"
                  />
                </div>
                <input
                  value={openHouseDraft.hostAgent}
                  onChange={(event) => setOpenHouseDraft((current) => ({ ...current, hostAgent: event.target.value }))}
                  placeholder="Host agent"
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="Host agent"
                />
                <input
                  value={openHouseDraft.notes}
                  onChange={(event) => setOpenHouseDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Notes"
                  className="h-6 rounded border border-white/15 bg-black/20 px-1 text-[0.7rem]"
                  aria-label="Open house notes"
                />
                <div className="flex gap-1">
                  <button
                    type="submit"
                    disabled={pendingId === "add-open-house"}
                    className="rounded border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-[#7395B8]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingOpenHouse(false)}
                    className="rounded border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-[#7395B8]"
                  >
                    Cancel
                  </button>
                </div>
                {actionError["add-open-house"] ? (
                  <p className="text-[0.65rem] leading-snug text-amber-200">{actionError["add-open-house"]}</p>
                ) : null}
              </form>
            ) : (
              <div className="mb-1">
                <MiniButton label="Add open house" onClick={() => setAddingOpenHouse(true)}>Add</MiniButton>
              </div>
            )
          }
          renderActions={(item) => (
            <>
              <MiniButton disabled={pendingId === item.id || !item.sheet} onClick={() => void changeOpenHouse(item, "cancel")}>
                Cancel
              </MiniButton>
              <MiniButton disabled={pendingId === item.id || !item.sheet} onClick={() => void changeOpenHouse(item, "delete")}>
                Delete
              </MiniButton>
            </>
          )}
        />

        <Tile title="Open House Availability" botId="google-forms" live={live}>
          {openHouseError ? (
            <SheetProblem message={openHouseError} />
          ) : (feeds.openHouse?.rows ?? []).length === 0 ? (
            <EmptyTile message="No current open-house responses." />
          ) : (
            <div className="grid gap-1">
              {feeds.openHouse?.summary ? (
                <p className="truncate text-[0.65rem] text-[#7395B8]" title={feeds.openHouse.summary}>
                  {feeds.openHouse.summary}
                </p>
              ) : null}
              {(feeds.openHouse?.rows ?? []).map((row, index) => {
                const id = `open-${index}`;
                const text = `${row.agent || "No name"} · ${row.window || "—"} · Sat ${row.saturday || "—"} · Sun ${row.sunday || "—"}`;
                return (
                  <CompactRow
                    key={id}
                    text={text}
                    detail={row.notes || text}
                    expanded={expandedId === id}
                    onToggle={() => toggle(id)}
                  />
                );
              })}
            </div>
          )}
        </Tile>

        <OpsSheetCard
          title="Referral Exchange"
          botId="work-routine"
          live={live}
          items={opsCards?.referralExchange ?? []}
          note={opsNotes.referralExchange}
          empty="No referral assignments in the last 3 months."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
        />

        <Tile title="CINC Call History" botId="cinc" live={live}>
          {cardErrors?.cinc ? (
            <SheetProblem message={cardErrors.cinc} />
          ) : cincGroups.length === 0 ? (
            <EmptyTile message={feeds.cincNote || "No data in CINC."} />
          ) : (
            <>
              <div className="mb-1 flex gap-1">
                {(
                  [
                    ["today", "Today"],
                    ["week", "Week to date"],
                    ["year", "Year to date"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCincPeriod(id)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em] transition",
                      cincPeriod === id
                        ? "bg-[#1F6598]/45 text-foreground"
                        : "text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ul className="grid gap-1">
                {cincGroups.map((agent) => {
                  const line = `${agent.agent} · ${cincLine(agent[cincPeriod])}`;
                  return (
                    <li key={agent.agent} className="truncate text-xs text-foreground" title={line}>
                      {line}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Tile>

        <OpsSheetCard
          title="Client Anniversaries"
          botId="work-routine"
          live={live}
          items={opsCards?.clientAnniversaries ?? []}
          note={opsNotes.clientAnniversaries}
          empty="No upcoming anniversaries."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
        />

        <OpsSheetCard
          title="Client Birthdays"
          botId="work-routine"
          live={live}
          items={opsCards?.clientBirthdays ?? []}
          note={opsNotes.clientBirthdays}
          empty="No upcoming birthdays."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
        />

        <OpsSheetCard
          title="DocuSign Drafts"
          live={live}
          items={opsCards?.docusignDrafts ?? []}
          note={opsNotes.docusignDrafts}
          empty="No DocuSign drafts waiting to be sent."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
          errors={actionError}
          renderActions={(item) => (
            <>
              <MiniButton disabled={pendingId === item.id} onClick={() => void queueDocusign(item, "send")}>
                Send
              </MiniButton>
              <MiniButton disabled={pendingId === item.id} onClick={() => void queueDocusign(item, "delete")}>
                Delete
              </MiniButton>
            </>
          )}
        />

        <OpsSheetCard
          title="Upcoming Subject Removals"
          live={live}
          items={opsCards?.subjectRemovals ?? []}
          note={opsNotes.subjectRemovals}
          empty="No upcoming subject removals."
          expandedId={expandedId}
          onToggle={toggle}
          hidden={hiddenIds}
        />

        <Tile title="Upcoming Transaction Dates" live={live}>
          {opsNotes.completionDates && (feeds.transactionDates ?? []).length === 0 ? (
            <div className="mb-0.5">
              <SheetProblem message={opsNotes.completionDates} />
            </div>
          ) : null}
          {(feeds.transactionDates ?? []).length === 0 && !opsNotes.completionDates ? (
            <EmptyTile message="No upcoming transaction dates." />
          ) : (feeds.transactionDates ?? []).length === 0 ? null : (
            <ul className="grid gap-0.5">
              {(feeds.transactionDates ?? []).map((line, index) => (
                <li key={`${line}-${index}`} title={line} className="truncate text-xs text-foreground">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile
          title="Tenant Notice Date Calculator (BC)"
          className="col-span-full max-h-none p-3 sm:p-4"
        >
          <TenantNoticeCalculator variant="card" />
        </Tile>
      </div>
    </div>
  );
}

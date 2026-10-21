"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { opsActions, type OpsAction } from "@/lib/ops-actions";
import { ActionPanel } from "@/components/action-panel";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const tileClass = cn(
  "group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[#7395B8]/30 bg-white/[0.07] px-4 py-3.5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300",
  "hover:-translate-y-0.5 hover:border-[#7395B8]/70 hover:bg-white/[0.11] hover:shadow-[0_16px_40px_rgba(31,101,152,0.28)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7395B8]/60"
);

function TileContent({ action }: { action: OpsAction }) {
  const Icon = action.icon;
  return (
    <>
      <span className="pointer-events-none flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#1F6598]/30 text-[#7395B8] ring-1 ring-[#7395B8]/35 transition group-hover:bg-[#1F6598]/55 group-hover:text-white group-hover:ring-[#7395B8]/60">
        <Icon className="size-[1.15rem]" aria-hidden />
      </span>
      <span className="pointer-events-none min-w-0 font-medium tracking-tight text-foreground">
        {action.label}
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#7395B8]/60 to-transparent opacity-0 transition group-hover:opacity-100" />
    </>
  );
}

export function OpsCommandCenter() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [active, setActive] = useState<OpsAction | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return opsActions;
    return opsActions.filter((action) => {
      const nested = action.nestedOptions
        ?.flatMap((option) => [
          option.label,
          ...(option.children?.map((child) => child.label) ?? []),
        ])
        .join(" ");
      const haystack = [action.label, action.description, nested ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [deferredQuery]);

  function openAction(action: OpsAction) {
    if (action.external && action.href) {
      window.open(action.href, "_blank", "noopener,noreferrer");
      return;
    }
    if (action.href) return;
    setActive(action);
    setPanelOpen(true);
  }

  function handlePanelOpenChange(next: boolean) {
    setPanelOpen(next);
    if (!next) {
      // Clear after close so a leftover dialog layer cannot trap the next click
      window.setTimeout(() => setActive(null), 120);
    }
  }

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
      <header className="animate-rise mb-8 max-w-2xl">
        <h1 className="font-heading text-[clamp(1.75rem,4.5vw,2.75rem)] font-medium leading-[1.1] tracking-tight text-foreground">
          What do you want to do today?
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Enter the details here — we send the job to the right bot to complete.
        </p>
      </header>

      <div className="animate-rise-delay relative mb-8">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search actions — conveyancing, opens, DocuSign…"
          aria-label="Search operations actions"
          className="h-12 rounded-2xl border-white/12 bg-white/[0.07] pl-11 pr-11 text-base shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl placeholder:text-muted-foreground/80"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/20 bg-white/[0.04] px-6 py-16 text-center backdrop-blur-md animate-fade">
          <p className="font-heading text-lg text-foreground">No matching actions</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Try “offer”, “Fintrac”, or “opens”.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((action, index) => {
            const style = {
              animation: "rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both",
              animationDelay: `${0.03 + index * 0.025}s`,
            } as const;

            if (action.href && !action.external) {
              return (
                <Link
                  key={action.id}
                  href={action.href}
                  className={tileClass}
                  style={style}
                >
                  <TileContent action={action} />
                </Link>
              );
            }

            return (
              <button
                key={action.id}
                type="button"
                data-action-id={action.id}
                onClick={() => openAction(action)}
                className={tileClass}
                style={style}
              >
                <TileContent action={action} />
              </button>
            );
          })}
        </div>
      )}

      {active ? (
        <ActionPanel
          key={active.id}
          action={active}
          open={panelOpen}
          onOpenChange={handlePanelOpenChange}
        />
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { artifactKindLabel } from "@/lib/artifacts";
import { botLabel } from "@/lib/ops-actions";
import {
  WebhookDeliveryBadge,
  WebhookDeliveryDetail,
} from "@/components/webhook-delivery-badge";
import {
  EmailDeliveryBadge,
  EmailDeliveryDetail,
} from "@/components/email-delivery-badge";
import { useLiveFeeds } from "@/hooks/use-live-feeds";
import { cn } from "@/lib/utils";

export function JobsInbox() {
  const { jobs, artifacts, drafts, live } = useLiveFeeds();

  return (
    <div className="relative mx-auto flex w-full max-w-4xl flex-col px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-[#7395B8] transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Dashboard
      </Link>

      <header className="mb-8">
        <h1 className="font-heading text-[clamp(1.75rem,4vw,2.5rem)] font-medium tracking-tight text-foreground">
          Job inbox
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything entered in the command center and sent to bots ·{" "}
          <span className={live ? "text-emerald-400" : "text-muted-foreground"}>
            {live ? "live" : "offline"}
          </span>
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 font-heading text-lg text-foreground">Jobs</h2>
        {jobs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/20 bg-white/[0.04] px-5 py-10 text-center text-sm text-muted-foreground">
            No jobs yet. Run an action from the{" "}
            <Link href="/" className="text-[#7395B8] hover:text-foreground">
              command center
            </Link>
            .
          </p>
        ) : (
          <ul className="grid gap-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-2xl border border-[#7395B8]/25 bg-white/[0.06] px-4 py-3.5 backdrop-blur-xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{job.actionLabel}</p>
                    <p className="mt-0.5 text-xs text-[#7395B8]">
                      {botLabel(job.bot)}
                      {job.optionPath?.length
                        ? ` · ${job.optionPath.join(" › ")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {job.bot !== "none" ? (
                      <WebhookDeliveryBadge delivery={job.webhookDelivery} />
                    ) : null}
                    <span
                      className={cn(
                        "rounded-md px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em]",
                        job.status === "done"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : job.status === "error"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-[#1F6598]/30 text-[#7395B8]"
                      )}
                    >
                      {job.status}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{job.summary}</p>
                {job.result ? (
                  <p className="mt-1.5 text-sm text-foreground/90">{job.result}</p>
                ) : null}
                {job.bot !== "none" ? (
                  <>
                    <WebhookDeliveryDetail delivery={job.webhookDelivery} />
                    {job.emailDelivery &&
                    job.webhookDelivery?.status === "not_configured" ? (
                      <>
                        <EmailDeliveryBadge
                          delivery={job.emailDelivery}
                          className="mt-1.5"
                        />
                        <EmailDeliveryDetail delivery={job.emailDelivery} />
                      </>
                    ) : null}
                  </>
                ) : null}
                <p className="mt-2 text-[0.7rem] text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-heading text-lg text-foreground">
          Bot artifacts
        </h2>
        {artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Documents, deals, DocuSign packs, and chat messages appear here when
            bots complete work.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {artifacts.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl border border-[#7395B8]/25 bg-white/[0.05] px-3.5 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <span className="text-[0.65rem] uppercase tracking-[0.12em] text-[#7395B8]">
                    {item.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                <p className="mt-2 text-[0.65rem] text-[#7395B8]">
                  {artifactKindLabel(item.kind)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-heading text-lg text-foreground">
          Email drafts ({drafts.length})
        </h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Conveyancing and Generate Email drafts show here.
          </p>
        ) : (
          <ul className="grid gap-2">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="rounded-2xl border border-[#7395B8]/25 bg-white/[0.05] px-4 py-3"
              >
                <p className="font-medium text-foreground">
                  {draft.draftEmail?.subject}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  To {draft.draftEmail?.to}
                </p>
                <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/25 p-3 text-xs leading-relaxed text-foreground/90">
                  {draft.draftEmail?.body}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

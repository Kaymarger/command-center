"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import {
  botLabel,
  type BotTarget,
  type NestedOption,
  type OpsAction,
} from "@/lib/ops-actions";
import type { EmailDelivery } from "@/lib/bot-email";
import {
  EmailDeliveryBadge,
  EmailDeliveryDetail,
} from "@/components/email-delivery-badge";
import {
  WebhookDeliveryBadge,
  WebhookDeliveryDetail,
  type WebhookDelivery,
} from "@/components/webhook-delivery-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ActionPanelProps = {
  action: OpsAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type AgentRow = { agent: string; window: string; coverage: string };

export function ActionPanel({ action, open, onOpenChange }: ActionPanelProps) {
  const [submitted, setSubmitted] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [composeUrl, setComposeUrl] = useState<string | null>(null);
  const [webhookDelivery, setWebhookDelivery] = useState<
    WebhookDelivery | undefined
  >();
  const [emailDelivery, setEmailDelivery] = useState<EmailDelivery | undefined>();
  const [pending, startTransition] = useTransition();
  const [path, setPath] = useState<NestedOption[]>([]);
  const [otherText, setOtherText] = useState("");
  const [whenText, setWhenText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [detailsText, setDetailsText] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [propertiesText, setPropertiesText] = useState("");
  const [copiesText, setCopiesText] = useState("1");
  const [deliveryMode, setDeliveryMode] = useState<"draft" | "send">("draft");
  const [files, setFiles] = useState<File[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  function resetLocal() {
    setSubmitted(false);
    setSuccessMessage("");
    setComposeUrl(null);
    setWebhookDelivery(undefined);
    setEmailDelivery(undefined);
    setPath([]);
    setOtherText("");
    setWhenText("");
    setNotesText("");
    setDetailsText("");
    setSecondaryText("");
    setPropertiesText("");
    setCopiesText("1");
    setDeliveryMode("draft");
    setFiles([]);
    setAgents([]);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetLocal();
    onOpenChange(next);
  }

  const currentOptions = useMemo(() => {
    if (!action?.nestedOptions) return null;
    if (path.length === 0) return action.nestedOptions;
    return path[path.length - 1].children ?? null;
  }, [action, path]);

  const leafSelected =
    !!action?.nestedOptions &&
    path.length > 0 &&
    !path[path.length - 1]?.children;

  const selectedLeaf = path[path.length - 1];
  const needsOther = leafSelected && !!selectedLeaf?.needsOtherText;
  const viewOnly = leafSelected && !!selectedLeaf?.viewOnly;
  const comingSoon = !!action?.comingSoon;
  const showForm =
    (!action?.nestedOptions || leafSelected) && !viewOnly && !comingSoon;
  const openHouseMode = action?.id === "open-houses";
  const addOpens = openHouseMode && selectedLeaf?.id === "add-opens";
  const deleteOpens = openHouseMode && selectedLeaf?.id === "delete-opens";
  const updateFeature =
    action?.id === "feature-sheet" && selectedLeaf?.id === "update-feature-sheets";
  const printFeature =
    action?.id === "feature-sheet" && selectedLeaf?.id === "send-for-printing";

  const effectiveBot: BotTarget =
    selectedLeaf?.botOverride ?? action?.bot ?? "none";

  useEffect(() => {
    if (!open || !viewOnly || selectedLeaf?.id !== "view-available-agents") {
      return;
    }
    let cancelled = false;
    setAgentsLoading(true);
    void fetch("/api/feeds/live", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { openHouse?: { rows?: AgentRow[] } }) => {
        if (!cancelled) setAgents(data.openHouse?.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, viewOnly, selectedLeaf?.id]);

  const showPropertySecondary =
    action?.id === "update-conveyancing"
      ? {
          label: "Property / file (optional)",
          placeholder: "123 Main Street",
        }
      : action?.id === "generate-email"
        ? {
            label: "To (email)",
            placeholder: "recipient@example.com",
          }
        : action?.id === "docusign"
          ? {
              label: "Signer / party notes (optional)",
              placeholder: "Buyer + seller emails, deadline…",
            }
          : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;

    const form = new FormData(event.currentTarget);
    const primaryValue = String(
      form.get(action.primaryField?.name ?? "value") ?? ""
    ).trim();
    const optionLabels = path.map((p) => p.label);
    const secondaryValue = secondaryText.trim();
    const detailsValue = detailsText.trim();
    const notesValue = notesText.trim();

    if (needsOther && !otherText.trim()) return;
    if (addOpens && !whenText.trim()) return;
    if (action.detailsField?.required && !detailsValue) return;
    if (updateFeature && !detailsValue) return;
    if (printFeature && !propertiesText.trim()) return;

    // Delete opens: no property required — Paragon wipe via transaction bot
    if (deleteOpens && !primaryValue) {
      // allow empty property for full Paragon delete
    } else if (action.primaryField && action.primaryField.required !== false) {
      if (!deleteOpens && !printFeature && !primaryValue) return;
    }

    startTransition(async () => {
      const summaryParts = [
        ...optionLabels,
        primaryValue,
        printFeature ? `Properties: ${propertiesText.trim()}` : "",
        printFeature ? `Copies: ${copiesText.trim() || "1"}` : "",
        secondaryValue ? `To/Party: ${secondaryValue}` : "",
        detailsValue ? `Details: ${detailsValue}` : "",
        notesValue ? `Notes: ${notesValue}` : "",
        otherText.trim() ? `Other: ${otherText.trim()}` : "",
        whenText.trim() ? `When: ${whenText.trim()}` : "",
        action.deliveryChoice
          ? deliveryMode === "send"
            ? "Delivery: Send"
            : "Delivery: Save draft"
          : "",
      ].filter(Boolean);

      const conveyancingMode =
        path[0]?.id === "conveyancing-reply"
          ? "reply"
          : path[0]?.id === "conveyancing-new-email"
            ? "new-email"
            : undefined;

      try {
        const res = await fetch("/api/bots/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionId: action.id,
            actionLabel: action.label,
            bot: effectiveBot,
            summary: summaryParts.join(" · "),
            optionPath: optionLabels,
            optionIds: path.map((p) => p.id),
            attachmentNames: files.map((f) => f.name),
            primaryValue:
              printFeature ? propertiesText.trim() : primaryValue || "Paragon open houses",
            secondaryValue: secondaryValue || undefined,
            detailsValue: detailsValue || notesValue || undefined,
            copies: printFeature ? Number(copiesText) || 1 : undefined,
            deliveryMode: action.deliveryChoice ? deliveryMode : undefined,
            conveyancingMode,
          }),
        });

        const data = (await res.json()) as {
          job?: {
            result?: string;
            status?: string;
            composeUrl?: string;
            webhookDelivery?: WebhookDelivery;
            emailDelivery?: EmailDelivery;
          };
          error?: string;
        };

        if (!res.ok || data.job?.status === "error") {
          throw new Error(data.error || data.job?.result || "Bot dispatch failed");
        }

        setSuccessMessage(data.job?.result || action.successHint);
        setComposeUrl(data.job?.composeUrl ?? null);
        setWebhookDelivery(data.job?.webhookDelivery);
        setEmailDelivery(data.job?.emailDelivery);
        setSubmitted(true);
      } catch (error) {
        setSuccessMessage(
          error instanceof Error ? error.message : "Could not reach bots."
        );
        setSubmitted(true);
      }
    });
  }

  if (!action || action.href) return null;

  const Icon = action.icon;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border/60 bg-popover/95 sm:max-w-lg backdrop-blur-xl">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#1F6598]/30 text-[#7395B8] ring-1 ring-[#7395B8]/35">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-heading text-xl tracking-tight">
                {action.label}
              </DialogTitle>
              {path.length > 0 ? (
                <p className="mt-1 truncate text-xs text-[#7395B8]">
                  {path.map((p) => p.label).join(" › ")}
                </p>
              ) : null}
            </div>
          </div>
          <DialogDescription>{action.description}</DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center animate-rise">
            <span className="flex size-12 items-center justify-center rounded-full bg-[#1F6598]/25 text-[#7395B8]">
              <CheckCircle2 className="size-6" />
            </span>
            <div>
              <p className="font-heading text-lg text-foreground">
                Sent to bot
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{successMessage}</p>
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <WebhookDeliveryBadge delivery={webhookDelivery} />
                <WebhookDeliveryDetail delivery={webhookDelivery} />
                {emailDelivery &&
                webhookDelivery?.status === "not_configured" ? (
                  <>
                    <EmailDeliveryBadge delivery={emailDelivery} />
                    <EmailDeliveryDetail delivery={emailDelivery} />
                  </>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-[#7395B8]">
                {botLabel(effectiveBot)} will complete this
              </p>
            </div>
            {composeUrl ? (
              <a
                href={composeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center rounded-lg bg-[#1F6598] px-4 text-sm font-medium text-white transition hover:bg-[#1F6598]/85"
              >
                {deliveryMode === "send" ? "Open in Gmail to send" : "Open in Gmail to save draft"}
              </a>
            ) : null}
            <Button className="mt-2" onClick={() => handleOpenChange(false)}>
              Back to command center
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {action.nestedOptions && !leafSelected ? (
              <div className="grid gap-2">
                {path.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setPath((prev) => prev.slice(0, -1))}
                    className="mb-1 flex items-center gap-1.5 text-sm text-[#7395B8] hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" />
                    Back
                  </button>
                ) : null}
                <div className="grid gap-2">
                  {(currentOptions ?? []).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setPath((prev) => [...prev, option]);
                        setOtherText("");
                      }}
                      className={cn(
                        "flex items-center justify-between rounded-xl border border-[#7395B8]/30 bg-white/[0.04] px-3.5 py-3 text-left transition",
                        "hover:border-[#7395B8]/70 hover:bg-white/[0.08]"
                      )}
                    >
                      <span className="font-medium text-foreground">
                        {option.label}
                      </span>
                      <ChevronRight className="size-4 text-[#7395B8]" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {comingSoon ? (
              <div className="grid gap-3 py-6 text-center">
                <p className="font-heading text-lg text-foreground">TBD</p>
                <p className="text-sm text-muted-foreground">
                  Prepare an Offer fields are coming next. Nothing is sent yet.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleOpenChange(false)}
                >
                  Back to command center
                </Button>
              </div>
            ) : null}

            {viewOnly && selectedLeaf?.id === "view-available-agents" ? (
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setPath((prev) => prev.slice(0, -1))}
                  className="flex items-center gap-1.5 text-sm text-[#7395B8] hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" />
                  Change option
                </button>
                <p className="text-sm text-muted-foreground">
                  Agents currently available for open houses (from Forms / listings
                  feed).
                </p>
                {agentsLoading ? (
                  <p className="text-sm text-[#7395B8]">Loading…</p>
                ) : agents.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/20 px-3 py-6 text-center text-sm text-muted-foreground">
                    No agents on the board yet. Add opens or sync Google Forms.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {agents.map((row, i) => (
                      <li
                        key={`${row.agent}-${i}`}
                        className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm"
                      >
                        <p className="font-medium text-foreground">{row.agent}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.window} · {row.coverage}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {showForm ? (
              <form onSubmit={handleSubmit} className="grid gap-4">
                {action.nestedOptions && leafSelected ? (
                  <button
                    type="button"
                    onClick={() => setPath((prev) => prev.slice(0, -1))}
                    className="flex items-center gap-1.5 text-sm text-[#7395B8] hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" />
                    Change option
                  </button>
                ) : null}

                {deleteOpens ? (
                  <p className="rounded-xl border border-[#7395B8]/30 bg-[#1F6598]/15 px-3 py-2.5 text-sm text-foreground/90">
                    This sends to <strong>Transaction bot</strong> to delete all
                    open-house listings from Paragon.
                  </p>
                ) : null}

                {!deleteOpens && !printFeature && action.primaryField ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${action.id}-${action.primaryField.name}`}>
                      {action.primaryField.label}
                    </Label>
                    {action.primaryField.multiline ? (
                      <Textarea
                        id={`${action.id}-${action.primaryField.name}`}
                        name={action.primaryField.name}
                        placeholder={action.primaryField.placeholder}
                        required
                        className="bg-muted/40"
                      />
                    ) : (
                      <Input
                        id={`${action.id}-${action.primaryField.name}`}
                        name={action.primaryField.name}
                        placeholder={action.primaryField.placeholder}
                        required
                        className="h-10 bg-muted/40"
                      />
                    )}
                  </div>
                ) : null}

                {printFeature ? (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor="print-properties">
                        Properties (one per line or comma-separated)
                      </Label>
                      <Textarea
                        id="print-properties"
                        value={propertiesText}
                        onChange={(e) => setPropertiesText(e.target.value)}
                        placeholder={"123 Main St\n456 Oak Ave\n789 Pine Rd"}
                        required
                        className="bg-muted/40"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="print-copies">Copies per property</Label>
                      <Input
                        id="print-copies"
                        type="number"
                        min={1}
                        value={copiesText}
                        onChange={(e) => setCopiesText(e.target.value)}
                        className="h-10 bg-muted/40"
                        required
                      />
                    </div>
                  </>
                ) : null}

                {showPropertySecondary ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${action.id}-secondary`}>
                      {showPropertySecondary.label}
                    </Label>
                    <Input
                      id={`${action.id}-secondary`}
                      value={secondaryText}
                      onChange={(e) => setSecondaryText(e.target.value)}
                      placeholder={showPropertySecondary.placeholder}
                      className="h-10 bg-muted/40"
                    />
                  </div>
                ) : null}

                {addOpens ? (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor="open-when">Date & time</Label>
                      <Input
                        id="open-when"
                        value={whenText}
                        onChange={(e) => setWhenText(e.target.value)}
                        placeholder="Sat 1–3pm"
                        required
                        className="h-10 bg-muted/40"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="open-notes">Notes</Label>
                      <Textarea
                        id="open-notes"
                        value={notesText}
                        onChange={(e) => setNotesText(e.target.value)}
                        placeholder="Signage, parking, co-host, special instructions…"
                        className="bg-muted/40"
                      />
                    </div>
                  </>
                ) : null}

                {updateFeature ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="feature-update">What is the update?</Label>
                    <Textarea
                      id="feature-update"
                      value={detailsText}
                      onChange={(e) => setDetailsText(e.target.value)}
                      placeholder="Price change, new photos, room sizes, copy edits…"
                      required
                      className="bg-muted/40"
                    />
                  </div>
                ) : null}

                {action.detailsField && !updateFeature ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${action.id}-details`}>
                      {action.detailsField.label}
                    </Label>
                    <Textarea
                      id={`${action.id}-details`}
                      value={detailsText}
                      onChange={(e) => setDetailsText(e.target.value)}
                      placeholder={action.detailsField.placeholder}
                      required={!!action.detailsField.required}
                      className="bg-muted/40"
                    />
                  </div>
                ) : null}

                {needsOther ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="other-text">Describe other</Label>
                    <Input
                      id="other-text"
                      value={otherText}
                      onChange={(e) => setOtherText(e.target.value)}
                      placeholder="Enter details"
                      required
                      className="h-10 bg-muted/40"
                    />
                  </div>
                ) : null}

                {action.deliveryChoice ? (
                  <div className="grid gap-2">
                    <Label>Delivery</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ["draft", "Save draft"],
                          ["send", "Send"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setDeliveryMode(id)}
                          className={cn(
                            "rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                            deliveryMode === id
                              ? "border-[#7395B8] bg-[#1F6598]/35 text-foreground"
                              : "border-white/15 bg-white/[0.03] text-muted-foreground hover:border-[#7395B8]/50"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {action.attachments ? (
                  <div className="grid gap-2">
                    <Label htmlFor={`${action.id}-files`}>Attachments</Label>
                    <label
                      htmlFor={`${action.id}-files`}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#7395B8]/40 bg-white/[0.03] px-3 py-3 text-sm text-muted-foreground transition hover:border-[#7395B8]/70 hover:text-foreground"
                    >
                      <Paperclip className="size-4 text-[#7395B8]" />
                      {action.id === "areg-chat"
                        ? "Add files for AREG Chat"
                        : "Add attachments"}
                    </label>
                    <input
                      id={`${action.id}-files`}
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        const next = Array.from(e.target.files ?? []);
                        setFiles((prev) => [...prev, ...next]);
                      }}
                    />
                    {files.length > 0 ? (
                      <ul className="grid gap-1.5">
                        {files.map((file) => (
                          <li
                            key={`${file.name}-${file.size}-${file.lastModified}`}
                            className="flex items-center justify-between rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-sm"
                          >
                            <span className="truncate">{file.name}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setFiles((prev) =>
                                  prev.filter((f) => f !== file)
                                )
                              }
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="size-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                <DialogFooter className="mt-1 border-0 bg-transparent p-0 sm:justify-between">
                  <p className="self-center text-xs text-muted-foreground">
                    Sends to {botLabel(effectiveBot)}
                  </p>
                  <Button type="submit" disabled={pending} className="min-w-32">
                    {pending ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Sending
                      </>
                    ) : action.deliveryChoice ? (
                      deliveryMode === "send" ? (
                        "Send"
                      ) : (
                        "Save draft"
                      )
                    ) : (
                      `Send to ${botLabel(effectiveBot)}`
                    )}
                  </Button>
                </DialogFooter>
              </form>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import type { BotArtifact } from "@/lib/artifacts";
import type { BotTarget } from "@/lib/ops-actions";
import { botLabel } from "@/lib/ops-actions";
import { botEmailAddress } from "@/lib/bot-email";
import { defaultBotWebhookUrl } from "@/lib/bot-webhook-urls";
import {
  enqueueGmail,
  gmailComposeUrl,
} from "@/lib/gmail-outbox";
import {
  addArtifact,
  createJobId,
  ensureFeedLoop,
  getFeeds,
  reloadFeedsFromDisk,
  setFeeds,
  loadJob,
  upsertJob,
  type BotJob,
  type DraftEmail,
} from "@/lib/bot-store";

export type DispatchInput = {
  actionId: string;
  actionLabel: string;
  bot: BotTarget;
  summary: string;
  optionPath?: string[];
  optionIds?: string[];
  attachmentNames?: string[];
  primaryValue?: string;
  secondaryValue?: string;
  detailsValue?: string;
  copies?: number;
  deliveryMode?: "draft" | "send";
  conveyancingMode?: "reply" | "new-email";
};

const botEnvKeys: Record<Exclude<BotTarget, "none">, string> = {
  transaction: "BOT_TRANSACTION_URL",
  listings: "BOT_LISTINGS_URL",
  manager: "BOT_MANAGER_URL",
  "work-routine": "BOT_WORK_ROUTINE_URL",
};

const botAuthEnvKeys: Record<Exclude<BotTarget, "none">, string> = {
  transaction: "BOT_TRANSACTION_KEY",
  listings: "BOT_LISTINGS_KEY",
  manager: "BOT_MANAGER_KEY",
  "work-routine": "BOT_WORK_ROUTINE_KEY",
};

const dealStageByAction: Record<string, string> = {
  "new-listing": "New listing",
  "relist-property": "Relist",
  "prepare-offer": "Offer prep",
  "accepted-offer": "Accepted offer",
  "prepare-subject-removal": "Subject removal",
  "firm-offer": "Firm",
};

function externalBotUrl(bot: BotTarget): string | undefined {
  if (bot === "none") return undefined;
  const key = botEnvKeys[bot];
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  return defaultBotWebhookUrl(bot);
}

function externalBotAuthKey(bot: BotTarget): string | undefined {
  if (bot === "none") return undefined;
  const key = botAuthEnvKeys[bot];
  const value = process.env[key]?.trim();
  return value || undefined;
}

function buildPlainEnglishSummary(
  job: BotJob,
  input: DispatchInput
): string {
  const bot = botLabel(job.bot);
  const option = job.optionPath?.length
    ? ` (${job.optionPath.join(" › ")})`
    : "";
  const parts = [
    `Please complete this AREG Ops job: ${job.actionLabel}${option}.`,
    `You are the ${bot}.`,
    input.primaryValue ? `Main detail: ${input.primaryValue}.` : null,
    input.secondaryValue ? `Also: ${input.secondaryValue}.` : null,
    input.detailsValue ? `Notes: ${input.detailsValue}.` : null,
    typeof input.copies === "number" ? `Copies: ${input.copies}.` : null,
    input.deliveryMode
      ? `Delivery choice: ${input.deliveryMode === "send" ? "Send" : "Save draft"}.`
      : null,
    input.conveyancingMode
      ? `Conveyancing mode: ${input.conveyancingMode === "reply" ? "Reply" : "New email"}.`
      : null,
    job.attachmentNames?.length
      ? `Attachments mentioned: ${job.attachmentNames.join(", ")}.`
      : null,
    `Full summary from the command center: ${job.summary}`,
  ].filter((line): line is string => line !== null);

  return parts.join(" ");
}

function webhookSettingNames(bot: BotTarget): { urlName: string; keyName: string } | null {
  if (bot === "none") return null;
  return { urlName: botEnvKeys[bot], keyName: botAuthEnvKeys[bot] };
}

function clipPlain(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.startsWith("<")) return "";
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

async function webhookReplyDetail(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      const message = parsed.error ?? parsed.message;
      if (typeof message === "string") return clipPlain(message);
    } catch {
      /* body is not JSON */
    }
    return clipPlain(text);
  } catch {
    return "";
  }
}

async function forwardToExternalBot(job: BotJob, input: DispatchInput) {
  const names = webhookSettingNames(job.bot);
  const label = botLabel(job.bot);
  const url = externalBotUrl(job.bot);
  if (!url || !names) {
    const urlName = names?.urlName ?? "BOT_*_URL";
    return {
      forwarded: false as const,
      delivery: {
        status: "not_configured" as const,
        error: `The ${label} webhook address is missing, so no request was sent. Add ${urlName} on the host, then send this job again.`,
      },
    };
  }

  const plainEnglishSummary = buildPlainEnglishSummary(job, input);
  const authKey = externalBotAuthKey(job.bot);
  if (!authKey) {
    return {
      forwarded: false as const,
      delivery: {
        status: "not_configured" as const,
        error: `The ${label} key is missing, so no request was sent. Add ${names.keyName} on the host. ${names.urlName} is already set.`,
      },
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${authKey}`,
      },
      body: JSON.stringify({
        id: job.id,
        actionId: job.actionId,
        actionLabel: job.actionLabel,
        bot: job.bot,
        botLabel: botLabel(job.bot),
        summary: job.summary,
        plainEnglishSummary,
        task: plainEnglishSummary,
        instruction: plainEnglishSummary,
        optionPath: job.optionPath,
        optionIds: input.optionIds,
        primaryValue: input.primaryValue,
        secondaryValue: input.secondaryValue ?? job.secondaryValue,
        detailsValue: input.detailsValue,
        copies: input.copies,
        deliveryMode: input.deliveryMode,
        conveyancingMode: input.conveyancingMode,
        attachmentNames: job.attachmentNames,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }),
    });

    const detail = await webhookReplyDetail(res);
    if (!res.ok) {
      return {
        forwarded: false as const,
        delivery: {
          status: "failed" as const,
          httpStatus: res.status,
          error: detail
            ? `The ${label} did not accept this job. The webhook replied ${res.status}. ${detail}`
            : `The ${label} did not accept this job. The webhook replied ${res.status}. Check ${names.urlName} and ${names.keyName} on the host.`,
          sentAt: new Date().toISOString(),
        },
      };
    }

    return {
      forwarded: true as const,
      delivery: {
        status: "sent" as const,
        httpStatus: res.status,
        sentAt: new Date().toISOString(),
      },
    };
  } catch {
    return {
      forwarded: false as const,
      delivery: {
        status: "failed" as const,
        error: `The ${label} could not be reached, so there is no HTTP status. Check that ${names.urlName} on the host is the right webhook address.`,
        sentAt: new Date().toISOString(),
      },
    };
  }
}

function buildConveyancingDraft(input: DispatchInput): DraftEmail {
  const isReply = input.conveyancingMode === "reply";
  const primary = input.primaryValue?.trim() || "update";
  const property = input.secondaryValue?.trim();
  return {
    to: "conveyancing@remaxcrestsouthgranville.ca",
    subject: isReply
      ? `Re: Conveyancing${property ? ` — ${property.slice(0, 36)}` : ""}`
      : `Conveyancing${property ? ` — ${property.slice(0, 40)}` : ` — ${primary.slice(0, 40)}`}`,
    body: [
      isReply ? "Hi," : "Hello,",
      "",
      property ? `Re: ${property}` : "",
      property ? "" : null,
      primary,
      "",
      input.attachmentNames?.length
        ? `Attachments: ${input.attachmentNames.join(", ")}`
        : "",
      "",
      "Regards,",
      "Kayla Gerak",
      "Operations Coordinator",
      "Archibald Real Estate Group",
    ]
      .filter((line): line is string => line !== null)
      .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
      .join("\n"),
  };
}

function buildManagerDraft(input: DispatchInput): DraftEmail {
  const primary = input.primaryValue?.trim() || "Email request";
  const to = input.secondaryValue?.trim() || botEmailAddress("manager") || "";
  return {
    to,
    subject: `Draft email — ${primary.slice(0, 48)}`,
    body: [
      primary,
      "",
      input.attachmentNames?.length
        ? `Attachments: ${input.attachmentNames.join(", ")}`
        : "",
      "",
      "— Prepared by manager bot from AREG Ops",
    ]
      .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
      .join("\n"),
  };
}

function sentToComplete(bot: BotTarget, detail: string): string {
  return `Sent to ${botLabel(bot)} to complete. ${detail}`;
}

function makeArtifact(
  jobId: string,
  partial: Omit<BotArtifact, "id" | "jobId" | "createdAt">
): BotArtifact {
  return {
    id: createJobId(),
    jobId,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

async function queueGmail(
  jobId: string,
  actionId: string,
  draft: DraftEmail,
  mode: "draft" | "send"
) {
  const item = await enqueueGmail({
    mode,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    actionId,
    jobId,
  });
  const composeUrl = gmailComposeUrl(draft);
  return { item, composeUrl };
}

async function completeOpenHouseJob(
  input: DispatchInput,
  jobId: string
): Promise<{ result: string; artifacts: BotArtifact[]; composeUrl?: string }> {
  const optionId = input.optionIds?.[0] ?? "";
  const mode = input.optionPath?.[0] ?? "Open houses";
  const address = input.primaryValue?.trim() || "Property";
  const when =
    input.summary.match(/When:\s*([^·]+)/)?.[1]?.trim() || "TBD";
  const notes = input.detailsValue?.trim();

  // Delete Opens → Transaction bot deletes all Paragon open-house listings
  if (optionId === "delete-opens" || mode.toLowerCase().includes("delete")) {
    return {
      result: sentToComplete(
        "transaction",
        "Delete all open-house listings from Paragon."
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "deal",
          title: "Paragon — delete all opens",
          detail:
            "Transaction bot: remove all open-house listings from Paragon.",
          bot: "transaction",
          status: "queued",
        }),
      ],
    };
  }

  const feeds = getFeeds();
  const rows = [...(feeds.openHouse?.rows ?? [])];
  rows.unshift({
    agent: "AREG Ops",
    window: when,
    coverage: notes ? `${address} · ${notes}` : address,
  });
  if (rows.length > 40) rows.length = 40;
  await setFeeds({
    ...feeds,
    updatedAt: new Date().toISOString(),
    source: feeds.source === "empty" ? "webhook" : feeds.source,
    openHouse: {
      summary: `${rows.length} open house${rows.length === 1 ? "" : "s"} on the board`,
      rows,
    },
  });
  return {
    result: sentToComplete(
      "listings",
      `Added open house for ${address} (${when})${notes ? ` — ${notes}` : ""}.`
    ),
    artifacts: [
      makeArtifact(jobId, {
        kind: "listing",
        title: `Open house · ${address}`,
        detail: notes ? `${when} · ${notes}` : when,
        property: address,
        bot: "listings",
        status: "done",
      }),
    ],
  };
}

async function completeListingsJob(
  input: DispatchInput,
  jobId: string
): Promise<{ result: string; artifacts: BotArtifact[] }> {
  const property = input.primaryValue?.trim() || "Property";
  const details = input.detailsValue?.trim();

  if (input.actionId === "open-houses") {
    return completeOpenHouseJob(input, jobId);
  }

  if (input.actionId === "new-listing") {
    return {
      result: sentToComplete(
        "listings",
        `New listing filed for ${property} — bot running listing pipeline (no team notify).`
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "listing",
          title: `New listing · ${property}`,
          detail: "Listing pipeline started (no team notify).",
          property,
          bot: "listings",
          status: "in-progress",
        }),
      ],
    };
  }

  if (input.actionId === "feature-sheet") {
    const leaf =
      input.optionPath?.[input.optionPath.length - 1] ?? "Feature sheet";
    const optionId = input.optionIds?.[input.optionIds.length - 1];
    if (optionId === "send-for-printing") {
      const copies =
        typeof input.copies === "number" && Number.isFinite(input.copies)
          ? input.copies
          : undefined;
      const where = property === "Property" ? "the properties listed" : property;
      return {
        result: sentToComplete(
          "listings",
          copies
            ? `Print ${copies} copies for ${where}.`
            : `Print feature sheets for ${where}.`
        ),
        artifacts: [
          makeArtifact(jobId, {
            kind: "feature-sheet",
            title: copies ? `Print · ${copies} copies` : "Print feature sheets",
            detail: property === "Property" ? details || "No property listed" : property,
            property: property === "Property" ? undefined : property,
            bot: "listings",
            status: "queued",
          }),
        ],
      };
    }
    const address = property === "Property" ? "no address given" : property;
    return {
      result: sentToComplete(
        "listings",
        `Feature sheet for ${address}${details ? `: ${details}` : ""}.`
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "feature-sheet",
          title: `${leaf} · ${address}`,
          detail: details || leaf,
          property: property === "Property" ? undefined : property,
          bot: "listings",
          status: "ready",
        }),
      ],
    };
  }

  if (input.actionId === "social-media") {
    const channel = input.optionPath?.length
      ? input.optionPath.join(", ")
      : "No platform selected";
    const notes = input.primaryValue?.trim() || "";
    return {
      result: sentToComplete(
        "listings",
        `${channel}${notes ? ` — ${notes}` : ""}.`
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "social",
          title: `${channel} draft`,
          detail: notes.slice(0, 160),
          channel,
          bot: "listings",
          status: "queued",
        }),
      ],
    };
  }

  return {
    result: sentToComplete("listings", input.summary),
    artifacts: [],
  };
}

async function completeTransactionJob(
  input: DispatchInput,
  jobId: string
): Promise<{
  result: string;
  draftEmail?: DraftEmail;
  artifacts: BotArtifact[];
  composeUrl?: string;
}> {
  const property = input.primaryValue?.trim() || "Property";
  const party = input.secondaryValue?.trim();
  const details = input.detailsValue?.trim();
  const delivery = input.deliveryMode ?? "draft";

  if (input.actionId === "send-gmail-draft" || input.actionId === "send-email-draft") {
    return {
      result: sentToComplete("transaction", input.summary),
      artifacts: [],
    };
  }

  if (input.actionId === "update-conveyancing") {
    const draft = buildConveyancingDraft(input);
    const gmail = await queueGmail(jobId, input.actionId, draft, delivery);
    return {
      draftEmail: draft,
      // Always hand back a Gmail compose link so Kayla can open/save/send immediately
      composeUrl: gmail.composeUrl,
      result:
        delivery === "send"
          ? sentToComplete(
              "transaction",
              "Conveyancing email ready — use Open in Gmail to send now. Also queued on the dashboard outbox."
            )
          : sentToComplete(
              "transaction",
              "Conveyancing draft ready — use Open in Gmail to save the draft. Also queued on the dashboard outbox."
            ),
      artifacts: [],
    };
  }

  if (input.actionId === "open-houses") {
    return completeOpenHouseJob(input, jobId);
  }

  if (input.actionId === "generate-document") {
    const doc =
      input.optionPath?.[input.optionPath.length - 1] ?? "Document";
    const other = input.summary.match(/Other:\s*([^·]+)/)?.[1]?.trim();
    return {
      result: sentToComplete(
        "transaction",
        `Document “${doc}” for ${property}${details ? ` — ${details.slice(0, 80)}` : ""}.`
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "document",
          title: `${doc}${other ? ` — ${other}` : ""}`,
          detail: details || `Ready for review · ${property}`,
          property,
          party,
          bot: "transaction",
          status: "ready",
        }),
      ],
    };
  }

  if (input.actionId === "docusign") {
    const update = input.primaryValue?.trim() || "DocuSign packet";
    return {
      result:
        delivery === "send"
          ? sentToComplete(
              "transaction",
              "DocuSign packet queued to send for signature."
            )
          : sentToComplete(
              "transaction",
              "DocuSign packet saved as draft."
            ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "docusign",
          title: update.slice(0, 72),
          detail: [
            delivery === "send" ? "Send" : "Save draft",
            party ? `Signers: ${party}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          property: party,
          party,
          bot: "transaction",
          status: delivery === "send" ? "queued" : "ready",
        }),
      ],
    };
  }

  if (input.actionId === "relist-property") {
    return {
      result: sentToComplete(
        "transaction",
        `Relist ${property}${details ? ` — ${details.slice(0, 80)}` : ""}.`
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "deal",
          title: `Relist · ${property}`,
          detail: details || "Relist requested",
          property,
          bot: "transaction",
          status: "in-progress",
        }),
      ],
    };
  }

  const stage = dealStageByAction[input.actionId];
  if (stage) {
    return {
      result: sentToComplete(
        "transaction",
        `${stage} recorded for ${property}${party ? ` (${party})` : ""}.`
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "deal",
          title: `${stage} · ${property}`,
          detail: party ? `Client / owner: ${party}` : stage,
          property,
          party,
          bot: "transaction",
          status: "in-progress",
        }),
      ],
    };
  }

  return {
    result: sentToComplete("transaction", input.summary),
    artifacts: [],
  };
}

async function completeManagerJob(
  input: DispatchInput,
  jobId: string
): Promise<{
  result: string;
  draftEmail?: DraftEmail;
  artifacts: BotArtifact[];
  composeUrl?: string;
}> {
  if (input.actionId === "generate-email") {
    const draft = buildManagerDraft(input);
    const delivery = input.deliveryMode ?? "draft";
    const gmail = await queueGmail(jobId, input.actionId, draft, delivery);
    return {
      draftEmail: draft,
      composeUrl: gmail.composeUrl,
      result:
        delivery === "send"
          ? sentToComplete(
              "manager",
              "Email ready — use Open in Gmail to send now. Also queued on the dashboard outbox."
            )
          : sentToComplete(
              "manager",
              "Email draft ready — use Open in Gmail to save the draft. Also queued on the dashboard outbox."
            ),
      artifacts: [],
    };
  }
  return {
    result: sentToComplete("manager", input.summary),
    artifacts: [],
  };
}

async function completeWorkRoutineJob(
  input: DispatchInput,
  jobId: string
): Promise<{ result: string; artifacts: BotArtifact[] }> {
  const message = input.primaryValue?.trim() || "AREG Chat update";
  return {
    result: sentToComplete(
      "work-routine",
      `AREG Chat message: “${message.slice(0, 80)}”`
    ),
    artifacts: [
      makeArtifact(jobId, {
        kind: "chat",
        title: message.slice(0, 72),
        detail: input.attachmentNames?.length
          ? `Attachments: ${input.attachmentNames.join(", ")}`
          : "Queued for Work Routine bot → AREG Chat",
        bot: "work-routine",
        status: "queued",
      }),
    ],
  };
}

function rememberJob(job: BotJob) {
  try {
    upsertJob(job);
  } catch {
    // A local save must not change what the webhook already did.
  }
}

export async function signalExistingJob(
  jobId: string,
  command: "pause" | "cancel",
): Promise<BotJob> {
  const existing = await loadJob(jobId);
  if (!existing) {
    throw new Error("That job is not on this dashboard.");
  }
  if (existing.status === "cancelled") {
    return existing;
  }
  const status = command === "pause" ? "paused" : "cancelled";
  const actionId = command === "pause" ? "pause-job" : "cancel-job";
  const actionLabel = command === "pause" ? "Pause job" : "Cancel job";
  const summary = `${command === "pause" ? "Pause" : "Cancel"} this job: ${existing.actionLabel}. ${existing.summary}`;
  const signal: BotJob = {
    ...existing,
    actionId,
    actionLabel,
    summary,
    status,
    updatedAt: new Date().toISOString(),
  };
  const input: DispatchInput = {
    actionId,
    actionLabel,
    bot: existing.bot,
    summary,
    primaryValue: existing.id,
    secondaryValue: existing.actionId,
  };
  const external = existing.bot === "none" ? null : await forwardToExternalBot(signal, input);
  const updated: BotJob = {
    ...existing,
    status,
    webhookDelivery: external?.delivery ?? existing.webhookDelivery,
    result: external?.forwarded
      ? `${command === "pause" ? "Paused" : "Cancelled"}. The webhook replied ${external.delivery.httpStatus}.`
      : external
        ? external.delivery.error ??
          `${command === "pause" ? "Paused" : "Cancelled"} on this dashboard. The webhook was not accepted.`
        : `${command === "pause" ? "Paused" : "Cancelled"} on this dashboard.`,
    updatedAt: new Date().toISOString(),
  };
  rememberJob(updated);
  return updated;
}

export async function dispatchToBot(
  input: DispatchInput
): Promise<BotJob & { composeUrl?: string }> {
  const now = new Date().toISOString();
  let job: BotJob = {
    id: createJobId(),
    actionId: input.actionId,
    actionLabel: input.actionLabel,
    bot: input.bot,
    summary: input.summary,
    optionPath: input.optionPath,
    attachmentNames: input.attachmentNames,
    secondaryValue: input.secondaryValue,
    status: "processing",
    createdAt: now,
    updatedAt: now,
  };

  // The webhook POST is the send. Do it before any local draft or file write.
  // On Vercel those writes throw (read-only disk) and used to stop the request.
  const external =
    job.bot === "none" ? null : await forwardToExternalBot(job, input);
  if (external) {
    job = { ...job, webhookDelivery: external.delivery };
  }

  let composeUrl: string | undefined;
  let artifacts: BotArtifact[] = [];
  try {
    ensureFeedLoop();
    await reloadFeedsFromDisk();

    if (input.actionId === "send-gmail-draft" || input.actionId === "send-email-draft") {
      job = { ...job, result: sentToComplete(input.bot, input.summary) };
    } else if (input.bot === "work-routine" || input.actionId === "areg-chat") {
      const completed = await completeWorkRoutineJob(input, job.id);
      artifacts = completed.artifacts;
      job = { ...job, bot: "work-routine", result: completed.result };
    } else if (input.bot === "listings") {
      const completed = await completeListingsJob(input, job.id);
      artifacts = completed.artifacts;
      job = { ...job, result: completed.result };
    } else if (input.bot === "transaction") {
      const completed = await completeTransactionJob(input, job.id);
      artifacts = completed.artifacts;
      composeUrl = completed.composeUrl;
      job = {
        ...job,
        draftEmail: completed.draftEmail,
        result: completed.result,
      };
    } else if (input.bot === "manager") {
      const completed = await completeManagerJob(input, job.id);
      artifacts = completed.artifacts;
      composeUrl = completed.composeUrl;
      job = {
        ...job,
        draftEmail: completed.draftEmail,
        result: completed.result,
      };
    } else {
      job = {
        ...job,
        result: `Job accepted to complete: ${input.summary}`,
      };
    }

    for (const artifact of artifacts) addArtifact(artifact);
  } catch {
    // Local bookkeeping failed. The webhook result below still stands.
  }

  if (external?.forwarded) {
    const code = external.delivery.httpStatus;
    job = {
      ...job,
      webhookDelivery: external.delivery,
      status: "done",
      result:
        typeof code === "number"
          ? `Sent to the ${botLabel(job.bot)}. The webhook replied ${code}.`
          : `Sent to the ${botLabel(job.bot)}.`,
      updatedAt: new Date().toISOString(),
    };
  } else if (external) {
    job = {
      ...job,
      webhookDelivery: external.delivery,
      status: "error",
      result:
        external.delivery.error ??
        `The ${botLabel(job.bot)} did not receive this job. No HTTP status came back.`,
      updatedAt: new Date().toISOString(),
    };
  } else {
    job = {
      ...job,
      artifactIds: artifacts.map((a) => a.id),
      status: "done",
      updatedAt: new Date().toISOString(),
    };
  }

  job = {
    ...job,
    artifactIds: artifacts.map((a) => a.id),
    updatedAt: new Date().toISOString(),
  };
  rememberJob(job);
  return { ...job, composeUrl };
}

export function botModeLabel(bot: BotTarget): string {
  if (bot === "none") return "Local";
  if (externalBotUrl(bot) && externalBotAuthKey(bot)) return "Webhook linked";
  if (externalBotUrl(bot) && !externalBotAuthKey(bot)) {
    return "Webhook address set — key missing";
  }
  if (!externalBotUrl(bot) && externalBotAuthKey(bot)) {
    return "Key set — webhook address missing";
  }
  return "Not linked yet";
}

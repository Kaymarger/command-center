import type { BotArtifact } from "@/lib/artifacts";
import type { BotTarget } from "@/lib/ops-actions";
import { botLabel } from "@/lib/ops-actions";
import {
  emailDeliveryLabel,
  emailJobToBot,
  botEmailAddress,
} from "@/lib/bot-email";
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

async function forwardToExternalBot(job: BotJob, input: DispatchInput) {
  const url = externalBotUrl(job.bot);
  if (!url) {
    return {
      forwarded: false as const,
      delivery: {
        status: "not_configured" as const,
        error: `No webhook URL set for ${botLabel(job.bot)}. Add the BOT_*_URL for this bot.`,
      },
    };
  }

  const plainEnglishSummary = buildPlainEnglishSummary(job, input);
  const authKey = externalBotAuthKey(job.bot);
  if (!authKey) {
    const authEnvName =
      job.bot === "none" ? "BOT_*_KEY" : botAuthEnvKeys[job.bot];
    return {
      forwarded: false as const,
      delivery: {
        status: "not_configured" as const,
        error: `Webhook URL is set for ${botLabel(job.bot)}, but its auth key is missing. Add ${authEnvName}.`,
      },
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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

    if (!res.ok) {
      return {
        forwarded: false as const,
        delivery: {
          status: "failed" as const,
          error: `${botLabel(job.bot)} webhook returned ${res.status}`,
          sentAt: new Date().toISOString(),
        },
      };
    }

    return {
      forwarded: true as const,
      delivery: {
        status: "sent" as const,
        sentAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      forwarded: false as const,
      delivery: {
        status: "failed" as const,
        error:
          error instanceof Error
            ? error.message
            : `Could not reach ${botLabel(job.bot)} webhook`,
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
      const copies = input.copies ?? 1;
      return {
        result: sentToComplete(
          "listings",
          `Print ${copies} copy/copies for: ${property}.`
        ),
        artifacts: [
          makeArtifact(jobId, {
            kind: "feature-sheet",
            title: `Print · ${copies}×`,
            detail: property,
            property,
            bot: "listings",
            status: "queued",
          }),
        ],
      };
    }
    return {
      result: sentToComplete(
        "listings",
        `Feature sheet update for ${property}${details ? `: ${details}` : ""}.`
      ),
      artifacts: [
        makeArtifact(jobId, {
          kind: "feature-sheet",
          title: `${leaf} · ${property}`,
          detail: details || leaf,
          property,
          bot: "listings",
          status: "ready",
        }),
      ],
    };
  }

  if (input.actionId === "social-media") {
    const channel = input.optionPath?.[0] ?? "Social";
    const notes = input.primaryValue?.trim() || "Social brief";
    return {
      result: sentToComplete(
        "listings",
        `${channel} post brief accepted — bot will publish/schedule.`
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

export async function dispatchToBot(
  input: DispatchInput
): Promise<BotJob & { composeUrl?: string }> {
  ensureFeedLoop();
  await reloadFeedsFromDisk();

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
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  upsertJob(job);

  job = { ...job, status: "processing", updatedAt: new Date().toISOString() };
  upsertJob(job);

  try {
    await new Promise((resolve) => setTimeout(resolve, 280));

    let artifacts: BotArtifact[] = [];
    let composeUrl: string | undefined;

    if (input.bot === "work-routine" || input.actionId === "areg-chat") {
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

    // Primary link: POST the job to the bot's webhook (BOT_*_URL + Bearer key)
    if (job.bot !== "none") {
      const external = await forwardToExternalBot(job, input);
      job = { ...job, webhookDelivery: external.delivery };

      if (external.forwarded) {
        job = {
          ...job,
          result: `${job.result ?? "Done"} Sent to ${botLabel(job.bot)} webhook.`,
        };
      } else if (external.delivery.status === "failed") {
        job = {
          ...job,
          result: `${job.result ?? "Done"} Webhook failed: ${external.delivery.error ?? "unknown error"}`,
          status: "error",
        };
      } else {
        // Optional fallback: email the bot only when webhook isn't configured
        const emailDelivery = await emailJobToBot({
          job,
          primaryValue: input.primaryValue,
          secondaryValue: input.secondaryValue,
          detailsValue: input.detailsValue,
          copies: input.copies,
          deliveryMode: input.deliveryMode,
          conveyancingMode: input.conveyancingMode,
        });
        job = { ...job, emailDelivery };

        if (emailDelivery.status === "sent") {
          job = {
            ...job,
            result: `${job.result ?? "Done"} No webhook yet — ${emailDeliveryLabel(emailDelivery)}.`,
          };
        } else if (emailDelivery.status === "failed") {
          job = {
            ...job,
            result: `${job.result ?? "Done"} ${emailDeliveryLabel(emailDelivery)}`,
          };
        } else {
          job = {
            ...job,
            result: `${job.result ?? "Done"} (${external.delivery.error ?? `Waiting for ${botLabel(job.bot)} webhook URL and key.`})`,
          };
        }
      }
    }

    job = {
      ...job,
      artifactIds: artifacts.map((a) => a.id),
      status: job.status === "error" ? "error" : "done",
      updatedAt: new Date().toISOString(),
    };
    upsertJob(job);
    return { ...job, composeUrl };
  } catch (error) {
    job = {
      ...job,
      status: "error",
      result: error instanceof Error ? error.message : "Bot failed",
      updatedAt: new Date().toISOString(),
    };
    upsertJob(job);
    return job;
  }
}

export function botModeLabel(bot: BotTarget): string {
  if (bot === "none") return "Local";
  if (externalBotUrl(bot) && externalBotAuthKey(bot)) return "Webhook linked";
  if (externalBotUrl(bot) && !externalBotAuthKey(bot)) {
    return "Webhook URL set — auth key missing";
  }
  if (botEmailAddress(bot)) return "Email fallback";
  return "Not linked yet";
}

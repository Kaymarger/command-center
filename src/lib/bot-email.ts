import nodemailer from "nodemailer";
import { promises as fs } from "fs";
import path from "path";
import type { BotTarget } from "@/lib/ops-actions";
import { botLabel } from "@/lib/ops-actions";
import type { BotJob } from "@/lib/bot-store";

export type EmailDeliveryStatus =
  | "sent"
  | "failed"
  | "skipped"
  | "not_configured";

export type EmailDelivery = {
  status: EmailDeliveryStatus;
  to?: string;
  subject?: string;
  provider?: string;
  error?: string;
  sentAt?: string;
};

export type BotEmailPayload = {
  job: BotJob;
  primaryValue?: string;
  secondaryValue?: string;
  detailsValue?: string;
  copies?: number;
  deliveryMode?: "draft" | "send";
  conveyancingMode?: "reply" | "new-email";
};

const botEmailEnvKeys: Record<Exclude<BotTarget, "none">, string> = {
  transaction: "BOT_TRANSACTION_EMAIL",
  listings: "BOT_LISTINGS_EMAIL",
  manager: "BOT_MANAGER_EMAIL",
  "work-routine": "BOT_WORK_ROUTINE_EMAIL",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function botEmailAddress(bot: BotTarget): string | undefined {
  if (bot === "none") return undefined;
  return env(botEmailEnvKeys[bot]);
}

export function emailTransportConfigured(): {
  ready: boolean;
  provider: string | null;
  reason?: string;
} {
  const provider = (env("EMAIL_PROVIDER") || "").toLowerCase();
  const from = env("EMAIL_FROM") || env("SMTP_FROM");

  if (provider === "console") {
    return { ready: true, provider: "console" };
  }

  if (provider === "resend" || env("RESEND_API_KEY")) {
    if (!env("RESEND_API_KEY")) {
      return {
        ready: false,
        provider: "resend",
        reason: "RESEND_API_KEY is missing",
      };
    }
    if (!from) {
      return {
        ready: false,
        provider: "resend",
        reason: "EMAIL_FROM is missing",
      };
    }
    return { ready: true, provider: "resend" };
  }

  if (provider === "smtp" || env("SMTP_HOST")) {
    if (!env("SMTP_HOST")) {
      return { ready: false, provider: "smtp", reason: "SMTP_HOST is missing" };
    }
    if (!from) {
      return {
        ready: false,
        provider: "smtp",
        reason: "EMAIL_FROM or SMTP_FROM is missing",
      };
    }
    return { ready: true, provider: "smtp" };
  }

  return {
    ready: false,
    provider: null,
    reason:
      "Set EMAIL_PROVIDER to smtp or resend (and the matching credentials), or console for local testing",
  };
}

export function buildBotJobEmail(payload: BotEmailPayload): {
  to: string;
  subject: string;
  body: string;
} | null {
  const { job } = payload;
  const to = botEmailAddress(job.bot);
  if (!to) return null;

  const option =
    job.optionPath?.length ? job.optionPath.join(" › ") : undefined;
  const subject = `[AREG Ops] ${job.actionLabel}${option ? ` — ${option}` : ""}`;

  const lines = [
    `Hello ${botLabel(job.bot)},`,
    "",
    "A new job was submitted from the AREG Ops Command Center. Please complete it.",
    "",
    "—— Job details ——",
    `Job type: ${job.actionLabel}`,
    option ? `Option: ${option}` : null,
    `Assigned bot: ${botLabel(job.bot)}`,
    `Job ID: ${job.id}`,
    `Submitted: ${new Date(job.createdAt).toLocaleString()}`,
    "",
    "Summary:",
    job.summary,
    "",
    payload.primaryValue ? `Main field: ${payload.primaryValue}` : null,
    payload.secondaryValue
      ? `Extra field: ${payload.secondaryValue}`
      : null,
    payload.detailsValue ? `Details / notes: ${payload.detailsValue}` : null,
    typeof payload.copies === "number"
      ? `Copies: ${payload.copies}`
      : null,
    payload.deliveryMode
      ? `Delivery choice: ${payload.deliveryMode === "send" ? "Send" : "Save draft"}`
      : null,
    payload.conveyancingMode
      ? `Conveyancing mode: ${payload.conveyancingMode === "reply" ? "Reply" : "New email"}`
      : null,
    job.attachmentNames?.length
      ? `Attachments named in app: ${job.attachmentNames.join(", ")}`
      : null,
    job.secondaryValue && !payload.secondaryValue
      ? `Secondary value: ${job.secondaryValue}`
      : null,
    "",
    "Please handle this job and update the dashboard when done.",
    "",
    "— AREG Ops Command Center",
  ].filter((line): line is string => line !== null);

  return { to, subject, body: lines.join("\n") };
}

async function sendViaResend(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is missing");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.body,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend API returned ${res.status}${text ? `: ${text}` : ""}`);
  }
}

async function sendViaSmtp(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  const host = env("SMTP_HOST");
  if (!host) throw new Error("SMTP_HOST is missing");

  const port = Number(env("SMTP_PORT") || "587");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const secure =
    env("SMTP_SECURE") === "true" || port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
}

async function sendViaConsole(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  const logPath = path.join(process.cwd(), "data", "bot-emails.log");
  const entry = [
    `---- ${new Date().toISOString()} ----`,
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "",
    input.body,
    "",
  ].join("\n");
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, entry, "utf8");
  console.info("[bot-email:console]", input.subject, "→", input.to);
}

export async function emailJobToBot(
  payload: BotEmailPayload
): Promise<EmailDelivery> {
  const { job } = payload;

  if (job.bot === "none") {
    return { status: "skipped", error: "This action does not go to a bot." };
  }

  const built = buildBotJobEmail(payload);
  if (!built) {
    const key =
      job.bot === "work-routine"
        ? "BOT_WORK_ROUTINE_EMAIL"
        : job.bot === "transaction"
          ? "BOT_TRANSACTION_EMAIL"
          : job.bot === "listings"
            ? "BOT_LISTINGS_EMAIL"
            : "BOT_MANAGER_EMAIL";
    return {
      status: "not_configured",
      error: `No email address set for ${botLabel(job.bot)}. Add ${key} in settings.`,
    };
  }

  const transport = emailTransportConfigured();
  if (!transport.ready || !transport.provider) {
    return {
      status: "not_configured",
      to: built.to,
      subject: built.subject,
      error:
        transport.reason ||
        "Email sending is not set up yet (SMTP or Resend).",
    };
  }

  const from =
    env("EMAIL_FROM") ||
    env("SMTP_FROM") ||
    "AREG Ops <ops@localhost>";

  try {
    if (transport.provider === "resend") {
      await sendViaResend({ from, ...built });
    } else if (transport.provider === "smtp") {
      await sendViaSmtp({ from, ...built });
    } else {
      await sendViaConsole({ from, ...built });
    }

    return {
      status: "sent",
      to: built.to,
      subject: built.subject,
      provider: transport.provider,
      sentAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      to: built.to,
      subject: built.subject,
      provider: transport.provider,
      error: error instanceof Error ? error.message : "Email send failed",
      sentAt: new Date().toISOString(),
    };
  }
}

export function emailDeliveryLabel(delivery?: EmailDelivery): string {
  if (!delivery) return "Email not attempted";
  if (delivery.status === "sent") {
    return `Emailed to ${delivery.to ?? "bot"}`;
  }
  if (delivery.status === "failed") {
    return `Email failed${delivery.error ? `: ${delivery.error}` : ""}`;
  }
  if (delivery.status === "not_configured") {
    return delivery.error || "Email not configured";
  }
  return delivery.error || "Email skipped";
}

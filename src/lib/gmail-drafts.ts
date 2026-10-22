import { createSign } from "node:crypto";
import type { OpsCardItem } from "@/lib/dashboard-data";
import { formatMonthDay, type CalendarDay } from "@/lib/dashboard-text";
import { loadServiceAccount } from "@/lib/google-sheets";

export type GmailDraftRead =
  | { ok: true; items: OpsCardItem[] }
  | { ok: false; reason: "unconfigured" }
  | { ok: false; reason: "error"; message: string };

type TokenCache = { token: string; expiresAt: number; key: string };

const cache = globalThis as typeof globalThis & {
  __areg_gmail_token__?: TokenCache;
  __areg_gmail_drafts__?: { at: number; items: OpsCardItem[] };
};

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRAFT_CACHE_MS = 60_000;

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function base64url(value: string | Buffer): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
}

function configured(): "access" | "refresh" | "delegation" | null {
  if (envValue("GMAIL_ACCESS_TOKEN")) return "access";
  if (envValue("GMAIL_REFRESH_TOKEN") && envValue("GMAIL_CLIENT_ID") && envValue("GMAIL_CLIENT_SECRET")) {
    return "refresh";
  }
  if (envValue("GMAIL_DELEGATED_USER")) {
    try {
      if (loadServiceAccount()) return "delegation";
    } catch {
      return null;
    }
  }
  return null;
}

async function delegatedToken(): Promise<string> {
  const account = loadServiceAccount();
  const subject = envValue("GMAIL_DELEGATED_USER");
  if (!account || !subject) throw new Error("Gmail is not connected.");
  const key = `${GMAIL_SCOPE}|${subject}`;
  const cached = cache.__areg_gmail_token__;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: GMAIL_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      sub: subject,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || `Google refused the Gmail sign-in (HTTP ${res.status}).`);
  }
  cache.__areg_gmail_token__ = { token: body.access_token, expiresAt: Date.now() + 50 * 60 * 1000, key };
  return body.access_token;
}

async function refreshedToken(): Promise<string> {
  const key = "refresh";
  const cached = cache.__areg_gmail_token__;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: envValue("GMAIL_REFRESH_TOKEN"),
      client_id: envValue("GMAIL_CLIENT_ID"),
      client_secret: envValue("GMAIL_CLIENT_SECRET"),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || `Google refused the Gmail sign-in (HTTP ${res.status}).`);
  }
  cache.__areg_gmail_token__ = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000,
    key,
  };
  return body.access_token;
}

async function gmailToken(): Promise<string> {
  const mode = configured();
  if (mode === "access") return envValue("GMAIL_ACCESS_TOKEN");
  if (mode === "refresh") return refreshedToken();
  if (mode === "delegation") return delegatedToken();
  throw new Error("Gmail is not connected.");
}

function headerValue(headers: { name?: string; value?: string }[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function draftLine(input: { id: string; subject: string; to: string; snippet: string; link: string; date: CalendarDay | null }): OpsCardItem {
  const text = [input.date ? formatMonthDay(input.date) : "", input.subject || input.snippet || "Email draft"]
    .filter(Boolean)
    .join(" · ");
  return {
    id: `gmail-${input.id}`,
    text,
    detail: [input.to ? `To ${input.to}` : "", input.snippet].filter(Boolean).join("\n"),
    href: input.link,
  };
}

/** Gmail drafts when this app has mailbox access. Otherwise the caller uses the EmailDrafts tab. */
export async function readGmailDrafts(): Promise<GmailDraftRead> {
  if (!configured()) return { ok: false, reason: "unconfigured" };
  const cached = cache.__areg_gmail_drafts__;
  if (cached && Date.now() - cached.at < DRAFT_CACHE_MS) return { ok: true, items: cached.items };
  try {
    const token = await gmailToken();
    const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=10", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json().catch(() => ({}))) as {
      drafts?: { id?: string; message?: { id?: string } }[];
      error?: { message?: string };
    };
    if (!listRes.ok) {
      throw new Error(list.error?.message || `Gmail drafts could not be read (HTTP ${listRes.status}).`);
    }
    const drafts = list.drafts ?? [];
    const items: OpsCardItem[] = [];
    for (const draft of drafts) {
      if (!draft.id) continue;
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draft.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Date`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: { id?: string; snippet?: string; payload?: { headers?: { name?: string; value?: string }[] } };
      };
      if (!res.ok) continue;
      const headers = body.message?.payload?.headers;
      const subject = headerValue(headers, "Subject");
      const to = headerValue(headers, "To");
      const dateText = headerValue(headers, "Date");
      const parsed = dateText ? new Date(dateText) : null;
      const date =
        parsed && !Number.isNaN(parsed.getTime())
          ? { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() }
          : null;
      const messageId = body.message?.id || draft.message?.id || "";
      const link = messageId ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(messageId)}` : "";
      items.push(draftLine({ id: draft.id, subject, to, snippet: body.message?.snippet?.trim() ?? "", link, date }));
    }
    cache.__areg_gmail_drafts__ = { at: Date.now(), items };
    return { ok: true, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail drafts could not be read.";
    return { ok: false, reason: "error", message: `${message} Showing the EmailDrafts tab instead.` };
  }
}

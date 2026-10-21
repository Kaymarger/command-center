import { promises as fs } from "fs";
import path from "path";

export type GmailOutboxItem = {
  id: string;
  mode: "draft" | "send";
  to: string;
  subject: string;
  body: string;
  actionId: string;
  jobId: string;
  status: "pending" | "drafted" | "sent" | "error";
  gmailId?: string;
  viewUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

const OUTBOX_PATH = path.join(process.cwd(), "data", "gmail-outbox.json");

async function readAll(): Promise<GmailOutboxItem[]> {
  try {
    const raw = await fs.readFile(OUTBOX_PATH, "utf8");
    const parsed = JSON.parse(raw) as GmailOutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(items: GmailOutboxItem[]) {
  await fs.mkdir(path.dirname(OUTBOX_PATH), { recursive: true });
  await fs.writeFile(OUTBOX_PATH, JSON.stringify(items, null, 2), "utf8");
}

export async function enqueueGmail(
  item: Omit<GmailOutboxItem, "id" | "status" | "createdAt" | "updatedAt">
): Promise<GmailOutboxItem> {
  const now = new Date().toISOString();
  const next: GmailOutboxItem = {
    ...item,
    id: crypto.randomUUID(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  try {
    const all = await readAll();
    all.unshift(next);
    await writeAll(all.slice(0, 100));
  } catch {
    // Vercel’s disk is read-only. A failed local copy must not block the webhook POST.
  }
  return next;
}

export async function listGmailOutbox(): Promise<GmailOutboxItem[]> {
  return readAll();
}

export async function markGmailOutbox(
  id: string,
  patch: Partial<GmailOutboxItem>
): Promise<GmailOutboxItem | null> {
  const all = await readAll();
  const index = all.findIndex((item) => item.id === id);
  if (index < 0) return null;
  all[index] = {
    ...all[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeAll(all);
  return all[index];
}

/** Gmail compose deep link as fallback when live API tokens are not in the app. */
export function gmailComposeUrl(input: {
  to: string;
  subject: string;
  body: string;
}): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: input.to,
    su: input.subject,
    body: input.body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

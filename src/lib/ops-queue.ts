export type QueuedOpsItem = {
  id: string;
  actionId: string;
  actionLabel: string;
  bot: "transaction" | "listings" | "manager" | "none";
  summary: string;
  optionPath?: string[];
  attachmentNames?: string[];
  draftEmail?: {
    to: string;
    subject: string;
    body: string;
  };
  createdAt: string;
};

const STORAGE_KEY = "areg-ops-queue";

export function readOpsQueue(): QueuedOpsItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedOpsItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOpsItem(
  item: Omit<QueuedOpsItem, "id" | "createdAt">
): QueuedOpsItem {
  const entry: QueuedOpsItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...readOpsQueue()].slice(0, 50);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("areg-ops-queue"));
  return entry;
}

export function clearOpsQueue() {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("areg-ops-queue"));
}

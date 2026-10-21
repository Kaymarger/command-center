import { promises as fs } from "fs";
import path from "path";
import {
  emptyFeeds,
  feedHasRows,
  type LiveFeeds,
} from "@/lib/dashboard-data";
import { readFeedsFile, writeFeedsFile } from "@/lib/feeds-io";
import type { BotArtifact } from "@/lib/artifacts";
import type { EmailDelivery } from "@/lib/bot-email";
import type { BotTarget } from "@/lib/ops-actions";

export type BotJobStatus = "queued" | "processing" | "done" | "error";

export type DraftEmail = {
  to: string;
  subject: string;
  body: string;
};

export type BotJob = {
  id: string;
  actionId: string;
  actionLabel: string;
  bot: BotTarget;
  summary: string;
  optionPath?: string[];
  attachmentNames?: string[];
  secondaryValue?: string;
  status: BotJobStatus;
  result?: string;
  draftEmail?: DraftEmail;
  /** Primary: webhook POST to the bot (BOT_*_URL) */
  webhookDelivery?: {
    status: "sent" | "failed" | "not_configured";
    httpStatus?: number;
    error?: string;
    sentAt?: string;
  };
  /** Optional fallback: email to the bot if no webhook URL */
  emailDelivery?: EmailDelivery;
  artifactIds?: string[];
  createdAt: string;
  updatedAt: string;
};

type BotStoreState = {
  jobs: BotJob[];
  artifacts: BotArtifact[];
  feeds: LiveFeeds;
  feedsLoaded: boolean;
  jobsLoaded: boolean;
  artifactsLoaded: boolean;
  listeners: Set<(event: string, payload?: unknown) => void>;
  feedTimer: ReturnType<typeof setInterval> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
  artifactPersistTimer: ReturnType<typeof setTimeout> | null;
};

const globalKey = "__areg_bot_store__";
const JOBS_PATH = path.join(process.cwd(), "data", "jobs.json");
const ARTIFACTS_PATH = path.join(process.cwd(), "data", "artifacts.json");

function getState(): BotStoreState {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: Partial<BotStoreState> & {
      jobs?: BotJob[];
      listeners?: Set<(event: string, payload?: unknown) => void>;
    };
  };
  if (!g[globalKey]) {
    g[globalKey] = {
      jobs: [],
      artifacts: [],
      feeds: emptyFeeds("empty"),
      feedsLoaded: false,
      jobsLoaded: false,
      artifactsLoaded: false,
      listeners: new Set(),
      feedTimer: null,
      persistTimer: null,
      artifactPersistTimer: null,
    };
  } else {
    // Hot reload / older store shape — fill missing fields
    const state = g[globalKey]!;
    if (!Array.isArray(state.artifacts)) state.artifacts = [];
    if (!Array.isArray(state.jobs)) state.jobs = [];
    if (!state.feeds) state.feeds = emptyFeeds("empty");
    if (!state.listeners) state.listeners = new Set();
    if (typeof state.artifactsLoaded !== "boolean") state.artifactsLoaded = false;
    if (typeof state.jobsLoaded !== "boolean") state.jobsLoaded = false;
    if (typeof state.feedsLoaded !== "boolean") state.feedsLoaded = false;
  }
  return g[globalKey] as BotStoreState;
}

async function ensureFeedsLoaded() {
  const state = getState();
  if (state.feedsLoaded) return;
  state.feeds = await readFeedsFile();
  state.feedsLoaded = true;
}

async function ensureJobsLoaded() {
  const state = getState();
  if (state.jobsLoaded) return;
  try {
    const raw = await fs.readFile(JOBS_PATH, "utf8");
    const parsed = JSON.parse(raw) as BotJob[];
    if (Array.isArray(parsed)) state.jobs = parsed.slice(0, 100);
  } catch {
    /* empty */
  }
  state.jobsLoaded = true;
}

async function ensureArtifactsLoaded() {
  const state = getState();
  if (state.artifactsLoaded) return;
  try {
    const raw = await fs.readFile(ARTIFACTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as BotArtifact[];
    if (Array.isArray(parsed)) state.artifacts = parsed.slice(0, 200);
  } catch {
    /* empty */
  }
  state.artifactsLoaded = true;
}

function schedulePersistJobs() {
  const state = getState();
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(() => {
    void fs
      .mkdir(path.dirname(JOBS_PATH), { recursive: true })
      .then(() =>
        fs.writeFile(JOBS_PATH, JSON.stringify(state.jobs, null, 2), "utf8")
      )
      .catch(() => undefined);
  }, 200);
}

function schedulePersistArtifacts() {
  const state = getState();
  if (state.artifactPersistTimer) clearTimeout(state.artifactPersistTimer);
  state.artifactPersistTimer = setTimeout(() => {
    void fs
      .mkdir(path.dirname(ARTIFACTS_PATH), { recursive: true })
      .then(() =>
        fs.writeFile(
          ARTIFACTS_PATH,
          JSON.stringify(state.artifacts, null, 2),
          "utf8"
        )
      )
      .catch(() => undefined);
  }, 200);
}

export function ensureFeedLoop() {
  const state = getState();
  void ensureFeedsLoaded();
  void ensureJobsLoaded();
  void ensureArtifactsLoaded();
  // The old 5s timer re-read data/feeds.json and pushed it to the dashboard.
  // On Vercel that file stays the empty copy from git (the disk is read-only),
  // so the push wiped Google rows and the cards fell through to the empty state.
  if (state.feedTimer) {
    clearInterval(state.feedTimer);
    state.feedTimer = null;
  }
}

export function subscribe(
  listener: (event: string, payload?: unknown) => void
) {
  const state = getState();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

function emit(event: string, payload?: unknown) {
  for (const listener of getState().listeners) {
    listener(event, payload);
  }
}

export function listJobs(): BotJob[] {
  void ensureJobsLoaded();
  return [...getState().jobs];
}

export function listDrafts(): BotJob[] {
  void ensureJobsLoaded();
  return getState().jobs.filter((job) => job.draftEmail);
}

export function listArtifacts(): BotArtifact[] {
  void ensureArtifactsLoaded();
  return [...getState().artifacts];
}

export function getFeeds(): LiveFeeds {
  ensureFeedLoop();
  return getState().feeds;
}

export async function reloadFeedsFromDisk(): Promise<LiveFeeds> {
  const state = getState();
  const fromDisk = await readFeedsFile();
  if (state.feedsLoaded && !feedHasRows(fromDisk) && feedHasRows(state.feeds)) {
    return state.feeds;
  }
  state.feeds = fromDisk;
  state.feedsLoaded = true;
  emit("feeds", state.feeds);
  return state.feeds;
}

export async function setFeeds(feeds: LiveFeeds): Promise<LiveFeeds> {
  const state = getState();
  state.feeds = feeds;
  state.feedsLoaded = true;
  await writeFeedsFile(feeds);
  emit("feeds", feeds);
  return feeds;
}

/** Kept for API compatibility — reloads actual persisted feeds (no sample nudge). */
export function refreshFeedsFromBots(): LiveFeeds {
  void reloadFeedsFromDisk();
  return getState().feeds;
}

export function upsertJob(job: BotJob) {
  const state = getState();
  state.jobsLoaded = true;
  const index = state.jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) state.jobs[index] = job;
  else state.jobs = [job, ...state.jobs].slice(0, 100);
  schedulePersistJobs();
  emit("job", job);
  emit("jobs", listJobs());
  if (job.draftEmail) emit("drafts", listDrafts());
}

export function addArtifact(artifact: BotArtifact) {
  const state = getState();
  state.artifactsLoaded = true;
  const current = Array.isArray(state.artifacts) ? state.artifacts : [];
  state.artifacts = [artifact, ...current].slice(0, 200);
  schedulePersistArtifacts();
  emit("artifacts", listArtifacts());
}

export function updateArtifactStatus(
  id: string,
  status: BotArtifact["status"]
) {
  const state = getState();
  const index = state.artifacts.findIndex((item) => item.id === id);
  if (index < 0) return;
  state.artifacts[index] = { ...state.artifacts[index], status };
  schedulePersistArtifacts();
  emit("artifacts", listArtifacts());
}

export function createJobId() {
  return crypto.randomUUID();
}

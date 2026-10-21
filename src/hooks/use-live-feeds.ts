"use client";

import { useEffect, useState } from "react";
import {
  emptyFeeds,
  type LiveFeeds,
  type SheetCardErrors,
} from "@/lib/dashboard-data";
import type { BotArtifact } from "@/lib/artifacts";
import type { BotJob } from "@/lib/bot-store";

export function useLiveFeeds() {
  const [feeds, setFeeds] = useState<LiveFeeds>(() => emptyFeeds());
  const [drafts, setDrafts] = useState<BotJob[]>([]);
  const [jobs, setJobs] = useState<BotJob[]>([]);
  const [artifacts, setArtifacts] = useState<BotArtifact[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [openHouseError, setOpenHouseError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<SheetCardErrors | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollId: number | null = null;

    async function pullOnce() {
      try {
        const [feedsRes, draftsRes, jobsRes, artifactsRes] = await Promise.all([
          fetch("/api/feeds/live", { cache: "no-store" }),
          fetch("/api/bots/drafts", { cache: "no-store" }),
          fetch("/api/bots/jobs", { cache: "no-store" }),
          fetch("/api/bots/artifacts", { cache: "no-store" }),
        ]);
        if (!feedsRes.ok) throw new Error(`Feed ${feedsRes.status}`);
        const feedsData = (await feedsRes.json()) as LiveFeeds & {
          sheetError?: string | null;
          openHouseError?: string | null;
          cardErrors?: SheetCardErrors | null;
        };
        const draftsData = draftsRes.ok
          ? ((await draftsRes.json()) as { drafts: BotJob[] })
          : { drafts: [] };
        const jobsData = jobsRes.ok
          ? ((await jobsRes.json()) as { jobs: BotJob[] })
          : { jobs: [] };
        const artifactsData = artifactsRes.ok
          ? ((await artifactsRes.json()) as { artifacts: BotArtifact[] })
          : { artifacts: [] };
        if (!cancelled) {
          setFeeds({ ...emptyFeeds(), ...feedsData });
          setSheetError(feedsData.sheetError ?? null);
          setOpenHouseError(feedsData.openHouseError ?? null);
          setCardErrors(feedsData.cardErrors ?? null);
          setDrafts(draftsData.drafts ?? []);
          setJobs(jobsData.jobs ?? []);
          setArtifacts(artifactsData.artifacts ?? []);
          setLive(true);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLive(false);
          setError(err instanceof Error ? err.message : "Feed offline");
        }
      }
    }

    void pullOnce();

    try {
      source = new EventSource("/api/bots/stream");
      source.addEventListener("feeds", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as LiveFeeds;
        if (!cancelled) {
          setFeeds({ ...emptyFeeds(), ...data });
          setLive(true);
          setError(null);
        }
      });
      source.addEventListener("drafts", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as BotJob[];
        if (!cancelled) setDrafts(data);
      });
      source.addEventListener("jobs", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as BotJob[];
        if (!cancelled) setJobs(data);
      });
      source.addEventListener("artifacts", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as BotArtifact[];
        if (!cancelled) setArtifacts(data);
      });
      source.onerror = () => {
        if (!cancelled) setLive(false);
      };
    } catch {
      /* EventSource unavailable */
    }

    pollId = window.setInterval(() => void pullOnce(), 8000);

    return () => {
      cancelled = true;
      source?.close();
      if (pollId) window.clearInterval(pollId);
    };
  }, []);

  async function syncFromSheet() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/feeds/sync", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        feeds?: LiveFeeds;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Sync failed");
      }
      if (data.feeds) setFeeds(data.feeds);
      setLive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return {
    feeds,
    drafts,
    jobs,
    artifacts,
    live,
    error,
    sheetError,
    openHouseError,
    cardErrors,
    syncing,
    syncFromSheet,
  };
}

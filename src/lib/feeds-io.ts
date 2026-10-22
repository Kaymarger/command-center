import { promises as fs } from "fs";
import path from "path";
import {
  emptyFeeds,
  emptyOpsCards,
  summarizeOpenHouses,
  type CincAgentStats,
  type IxactItem,
  type LiveFeeds,
  type OpenHouseRow,
  type OutstandingEmail,
  type ReferralItem,
} from "@/lib/dashboard-data";

const DATA_DIR = path.join(process.cwd(), "data");
const FEEDS_PATH = path.join(DATA_DIR, "feeds.json");

export async function readFeedsFile(): Promise<LiveFeeds> {
  try {
    const raw = await fs.readFile(FEEDS_PATH, "utf8");
    const parsed = JSON.parse(raw) as LiveFeeds;
    return {
      ...emptyFeeds(parsed.source ?? "mixed"),
      ...parsed,
      outstandingEmails: parsed.outstandingEmails ?? [],
      opsCards: parsed.opsCards ?? emptyOpsCards(),
      opsCardNotes: parsed.opsCardNotes ?? {},
      cincGroups: parsed.cincGroups ?? [],
      cincNote: parsed.cincNote ?? "",
      sheetEmailDrafts: parsed.sheetEmailDrafts ?? [],
      importantDates: parsed.importantDates ?? [],
      importantDatesDraft: parsed.importantDatesDraft ?? "",
      transactionDates: parsed.transactionDates ?? [],
      emailDraftNote: parsed.emailDraftNote ?? "",
    };
  } catch {
    return emptyFeeds("empty");
  }
}

export async function writeFeedsFile(feeds: LiveFeeds): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FEEDS_PATH, JSON.stringify(feeds, null, 2), "utf8");
  } catch {
    // Vercel’s disk is read-only. The dashboard still uses the in-memory copy.
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function num(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function feedsFromSheetTables(tables: {
  cinc: string[][];
  anniversaries: string[][];
  birthdays: string[][];
  referrals: string[][];
  openHouses: string[][];
  outstandingEmails: string[][];
}): LiveFeeds {
  const cincAgents: CincAgentStats[] = tables.cinc.slice(1).map((r, i) => ({
    id: `cinc-${i + 1}`,
    agent: r[0] ?? "",
    lastCall: r[1] ?? "",
    wtd: {
      calls: num(r[2]),
      connected: num(r[3]),
      appointments: num(r[4]),
    },
    mtd: {
      calls: num(r[5]),
      connected: num(r[6]),
      appointments: num(r[7]),
    },
    ytd: {
      calls: num(r[8]),
      connected: num(r[9]),
      appointments: num(r[10]),
    },
  })).filter((a) => a.agent.trim());

  const anniversaries: IxactItem[] = tables.anniversaries
    .slice(1)
    .map((r, i) => ({
      id: `ann-${i + 1}`,
      name: r[0] ?? "",
      date: r[1] ?? "",
      note: r[2] ?? "",
    }))
    .filter((a) => a.name.trim());

  const birthdays: IxactItem[] = tables.birthdays
    .slice(1)
    .map((r, i) => ({
      id: `bday-${i + 1}`,
      name: r[0] ?? "",
      date: r[1] ?? "",
      note: r[2] ?? "",
    }))
    .filter((a) => a.name.trim());

  const referralRows = tables.referrals.slice(1).filter((r) => r[0]?.trim());
  const referrals = {
    active: referralRows
      .filter((r) => (r[1] || "").toLowerCase() !== "history")
      .map((r, i) => ({
        id: `ref-a-${i + 1}`,
        name: r[0] ?? "",
        status: "active" as const,
        direction: r[2] ?? "",
        meta: r[3] ?? "",
      })),
    history: referralRows
      .filter((r) => (r[1] || "").toLowerCase() === "history")
      .map((r, i) => ({
        id: `ref-h-${i + 1}`,
        name: r[0] ?? "",
        status: "history" as const,
        direction: r[2] ?? "",
        meta: r[3] ?? "",
      })),
  };

  const openRows: OpenHouseRow[] = tables.openHouses
    .slice(1)
    .map((r) => ({
      agent: r[0] ?? "",
      window: r[1] ?? "",
      coverage: r[2] ?? "",
    }))
    .filter((r) => r.agent.trim());

  const outstandingEmails: OutstandingEmail[] = tables.outstandingEmails
    .slice(1)
    .map((r, i) => ({
      id: r[0]?.trim() || `oe-${i + 1}`,
      type: r[1] || "other",
      label: r[2] ?? "",
      detail: r[3] ?? "",
    }))
    .filter((e) => e.label.trim());

  return {
    updatedAt: new Date().toISOString(),
    source: "sheet",
    cincAgents,
    cincGroups: [],
    anniversaries,
    birthdays,
    referrals,
    openHouse: {
      rows: openRows,
      summary: summarizeOpenHouses(openRows),
    },
    outstandingEmails,
    opsCards: emptyOpsCards(),
    opsCardNotes: {},
    cincNote: "",
    sheetEmailDrafts: [],
  };
}

export function mergeWebhookFeeds(
  current: LiveFeeds,
  patch: Partial<LiveFeeds>
): LiveFeeds {
  const next: LiveFeeds = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    source: current.source === "empty" ? "webhook" : "mixed",
    openHouse: patch.openHouse
      ? {
          rows: patch.openHouse.rows,
          summary:
            patch.openHouse.summary ||
            summarizeOpenHouses(patch.openHouse.rows),
        }
      : current.openHouse,
    referrals: patch.referrals ?? current.referrals,
    cincAgents: patch.cincAgents ?? current.cincAgents,
    cincGroups: patch.cincGroups ?? current.cincGroups,
    anniversaries: patch.anniversaries ?? current.anniversaries,
    birthdays: patch.birthdays ?? current.birthdays,
    outstandingEmails:
      patch.outstandingEmails ?? current.outstandingEmails,
    opsCards: patch.opsCards ?? current.opsCards,
    opsCardNotes: patch.opsCardNotes ?? current.opsCardNotes,
    cincNote: patch.cincNote ?? current.cincNote,
    sheetEmailDrafts: patch.sheetEmailDrafts ?? current.sheetEmailDrafts,
  };
  return next;
}


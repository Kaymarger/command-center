import {
  emptyFeeds,
  sheetTabs,
  summarizeOpenHouses,
  type LiveFeeds,
} from "@/lib/dashboard-data";
import { feedsFromSheetTables } from "@/lib/feeds-io";
import { reloadFeedsFromDisk, setFeeds } from "@/lib/bot-store";
import {
  loadServiceAccount,
  openHouseRowsFromTable,
  openHouseSheetId,
  opsSheetId,
  readPublicCsv,
  readSpreadsheet,
  type SheetTab,
} from "@/lib/google-sheets";

const TAB_MATCHES: {
  key: keyof typeof sheetTabs;
  gid: number;
  names: string[];
}[] = [
  { key: "CINC", gid: sheetTabs.CINC, names: ["cinc"] },
  { key: "Anniversaries", gid: sheetTabs.Anniversaries, names: ["anniversar"] },
  { key: "Birthdays", gid: sheetTabs.Birthdays, names: ["birthday"] },
  { key: "Referrals", gid: sheetTabs.Referrals, names: ["referral"] },
  { key: "OpenHouses", gid: sheetTabs.OpenHouses, names: ["open house", "openhouse"] },
  {
    key: "OutstandingEmails",
    gid: sheetTabs.OutstandingEmails,
    names: ["outstanding", "email"],
  },
];

type DashboardPayload = {
  feeds: LiveFeeds;
  sheetError: string | null;
  openHouseError: string | null;
};

type Cache = DashboardPayload & { at: number };

const cacheGlobal = globalThis as typeof globalThis & {
  __areg_sheet_cache__?: Cache;
};

function pickTab(
  tabs: SheetTab[],
  gid: number,
  names: string[],
): { rows: string[][]; found: boolean } {
  const byGid = tabs.find((tab) => tab.sheetId === gid);
  if (byGid) return { rows: byGid.rows, found: true };
  const byName = tabs.find((tab) => {
    const title = tab.title.toLowerCase();
    return names.some((name) => title.includes(name));
  });
  if (byName) return { rows: byName.rows, found: true };
  return { rows: [], found: false };
}

async function opsTables(): Promise<{
  cinc: string[][];
  anniversaries: string[][];
  birthdays: string[][];
  referrals: string[][];
  openHouses: string[][];
  outstandingEmails: string[][];
  foundTitles: string[];
}> {
  const id = opsSheetId();
  if (!id) {
    throw new Error(
      "AREG_OPS_SHEET_ID is not set on the host, so the dashboard has nothing to read.",
    );
  }

  if (loadServiceAccount()) {
    const tabs = await readSpreadsheet(id);
    const cinc = pickTab(tabs, sheetTabs.CINC, ["cinc"]);
    const anniversaries = pickTab(tabs, sheetTabs.Anniversaries, ["anniversar"]);
    const birthdays = pickTab(tabs, sheetTabs.Birthdays, ["birthday"]);
    const referrals = pickTab(tabs, sheetTabs.Referrals, ["referral"]);
    const openHouses = pickTab(tabs, sheetTabs.OpenHouses, ["open house", "openhouse"]);
    const outstandingEmails = pickTab(tabs, sheetTabs.OutstandingEmails, [
      "outstanding",
      "email",
    ]);
    const foundAny = [
      cinc,
      anniversaries,
      birthdays,
      referrals,
      openHouses,
      outstandingEmails,
    ].some((tab) => tab.found);
    if (!foundAny) {
      const titles = tabs.map((tab) => tab.title).join(", ") || "none";
      throw new Error(
        `The dashboard sheet opened, but no tab matched the cards. Tabs in the file: ${titles}. Name them CINC, Anniversaries, Birthdays, Referrals, Open Houses, and Outstanding Emails.`,
      );
    }
    return {
      cinc: cinc.rows,
      anniversaries: anniversaries.rows,
      birthdays: birthdays.rows,
      referrals: referrals.rows,
      openHouses: openHouses.rows,
      outstandingEmails: outstandingEmails.rows,
      foundTitles: tabs.map((tab) => tab.title),
    };
  }

  const [cinc, anniversaries, birthdays, referrals, openHouses, outstandingEmails] =
    await Promise.all(
      TAB_MATCHES.map((tab) => readPublicCsv(id, tab.gid)),
    );
  return {
    cinc,
    anniversaries,
    birthdays,
    referrals,
    openHouses,
    outstandingEmails,
    foundTitles: [],
  };
}

export async function syncFeedsFromGoogleSheet(): Promise<LiveFeeds> {
  const tables = await opsTables();
  const feeds = feedsFromSheetTables({
    cinc: tables.cinc,
    anniversaries: tables.anniversaries,
    birthdays: tables.birthdays,
    referrals: tables.referrals,
    openHouses: tables.openHouses,
    outstandingEmails: tables.outstandingEmails,
  });
  return feeds;
}

async function readOpenHouseForm(): Promise<
  { rows: ReturnType<typeof openHouseRowsFromTable> } | { missing: true } | { error: string }
> {
  const id = openHouseSheetId();
  if (!id) return { missing: true };
  try {
    if (!loadServiceAccount()) {
      const rows = openHouseRowsFromTable(await readPublicCsv(id, 0));
      return { rows };
    }
    const tabs = await readSpreadsheet(id);
    const tab =
      tabs.find((item) => /response|form|avail/i.test(item.title)) ?? tabs[0];
    if (!tab) return { rows: [] };
    return { rows: openHouseRowsFromTable(tab.rows) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The open house form sheet could not be read.",
    };
  }
}

export async function loadDashboardFeeds(): Promise<DashboardPayload> {
  const cached = cacheGlobal.__areg_sheet_cache__;
  if (cached && Date.now() - cached.at < 30_000) {
    return cached;
  }

  let feeds = emptyFeeds();
  let sheetError: string | null = null;
  try {
    feeds = await syncFeedsFromGoogleSheet();
    await setFeeds(feeds);
  } catch (error) {
    sheetError =
      error instanceof Error
        ? error.message
        : "The dashboard sheet could not be read.";
    try {
      feeds = await reloadFeedsFromDisk();
    } catch {
      feeds = emptyFeeds();
    }
  }

  let openHouseError: string | null = null;
  const openHouse = await readOpenHouseForm();
  if ("missing" in openHouse) {
    if ((feeds.openHouse?.rows ?? []).length === 0) {
      openHouseError =
        "Open house sign-ups are not connected. Add OPEN_HOUSE_SHEET_ID (the spreadsheet id of the Google Form’s responses sheet) and share that sheet with the same Google service account as the dashboard.";
    }
  } else if ("error" in openHouse) {
    openHouseError = openHouse.error;
  } else {
    feeds = {
      ...feeds,
      openHouse: {
        rows: openHouse.rows,
        summary: summarizeOpenHouses(openHouse.rows),
      },
    };
  }

  const payload: DashboardPayload = { feeds, sheetError, openHouseError };
  cacheGlobal.__areg_sheet_cache__ = { ...payload, at: Date.now() };
  return payload;
}

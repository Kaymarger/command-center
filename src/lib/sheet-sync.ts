import {
  emptyFeeds,
  sheetTabs,
  summarizeOpenHouses,
  type LiveFeeds,
  type SheetCardErrors,
} from "@/lib/dashboard-data";
import { feedsFromSheetTables } from "@/lib/feeds-io";
import { reloadFeedsFromDisk, setFeeds } from "@/lib/bot-store";
import {
  formResponsesTab,
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
  cardErrors: SheetCardErrors;
};

function blankCardErrors(): SheetCardErrors {
  return {
    cinc: null,
    referrals: null,
    anniversaries: null,
    birthdays: null,
    emails: null,
  };
}

type Cache = DashboardPayload & { at: number };

const cacheGlobal = globalThis as typeof globalThis & {
  __areg_sheet_cache__?: Cache;
};

function pickTab(
  tabs: SheetTab[],
  gid: number,
  names: string[],
): { rows: string[][]; found: boolean; error: string | null } {
  const byGid = tabs.find((tab) => tab.sheetId === gid);
  const byName = tabs.find((tab) => {
    const title = tab.title.toLowerCase();
    return names.some((name) => title.includes(name));
  });
  const match = byGid ?? byName;
  if (!match) return { rows: [], found: false, error: null };
  return { rows: match.rows, found: true, error: match.error ?? null };
}

function missingTabMessage(label: string, titles: string[]): string {
  const found = titles.length ? titles.join(", ") : "none";
  return `The ${label} tab was not found in the dashboard sheet. Tabs Google returned: ${found}.`;
}

async function opsTables(): Promise<{
  cinc: string[][];
  anniversaries: string[][];
  birthdays: string[][];
  referrals: string[][];
  openHouses: string[][];
  outstandingEmails: string[][];
  cardErrors: SheetCardErrors;
}> {
  const id = opsSheetId();
  if (!id) {
    const message =
      "AREG_OPS_SHEET_ID is not set on the host, so this card has nothing to read.";
    return {
      cinc: [],
      anniversaries: [],
      birthdays: [],
      referrals: [],
      openHouses: [],
      outstandingEmails: [],
      cardErrors: {
        cinc: message,
        referrals: message,
        anniversaries: message,
        birthdays: message,
        emails: message,
      },
    };
  }

  if (loadServiceAccount()) {
    let tabs: SheetTab[] = [];
    try {
      tabs = await readSpreadsheet(id);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Google could not open the dashboard sheet.";
      return {
        cinc: [],
        anniversaries: [],
        birthdays: [],
        referrals: [],
        openHouses: [],
        outstandingEmails: [],
        cardErrors: {
          cinc: message,
          referrals: message,
          anniversaries: message,
          birthdays: message,
          emails: message,
        },
      };
    }
    const titles = tabs.map((tab) => tab.title);
    const cinc = pickTab(tabs, sheetTabs.CINC, ["cinc"]);
    const anniversaries = pickTab(tabs, sheetTabs.Anniversaries, ["anniversar"]);
    const birthdays = pickTab(tabs, sheetTabs.Birthdays, ["birthday"]);
    const referrals = pickTab(tabs, sheetTabs.Referrals, ["referral"]);
    const openHouses = pickTab(tabs, sheetTabs.OpenHouses, ["open house", "openhouse"]);
    const outstandingEmails = pickTab(tabs, sheetTabs.OutstandingEmails, [
      "outstanding",
      "email",
    ]);
    const cardErrors: SheetCardErrors = {
      cinc: cinc.error ?? (cinc.found ? null : missingTabMessage("CINC", titles)),
      anniversaries:
        anniversaries.error ??
        (anniversaries.found ? null : missingTabMessage("Anniversaries", titles)),
      birthdays:
        birthdays.error ??
        (birthdays.found ? null : missingTabMessage("Birthdays", titles)),
      referrals:
        referrals.error ??
        (referrals.found ? null : missingTabMessage("Referrals", titles)),
      emails:
        outstandingEmails.error ??
        (outstandingEmails.found
          ? null
          : missingTabMessage("Outstanding Emails", titles)),
    };
    return {
      cinc: cinc.rows,
      anniversaries: anniversaries.rows,
      birthdays: birthdays.rows,
      referrals: referrals.rows,
      openHouses: openHouses.rows,
      outstandingEmails: outstandingEmails.rows,
      cardErrors,
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
    cardErrors: blankCardErrors(),
  };
}

export async function syncFeedsFromGoogleSheet(): Promise<{
  feeds: LiveFeeds;
  cardErrors: SheetCardErrors;
}> {
  const tables = await opsTables();
  const feeds = feedsFromSheetTables({
    cinc: tables.cinc,
    anniversaries: tables.anniversaries,
    birthdays: tables.birthdays,
    referrals: tables.referrals,
    openHouses: tables.openHouses,
    outstandingEmails: tables.outstandingEmails,
  });
  return { feeds, cardErrors: tables.cardErrors };
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
    const tab = formResponsesTab(tabs);
    if (!tab) {
      return { error: "Google opened the open-house sheet, but it has no tabs." };
    }
    if (tab.error) return { error: tab.error };
    if (tab.rows.length === 0) {
      return {
        error: `Google opened the “${tab.title}” tab but sent back no cells.`,
      };
    }
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
  let cardErrors = blankCardErrors();
  try {
    const synced = await syncFeedsFromGoogleSheet();
    feeds = synced.feeds;
    cardErrors = synced.cardErrors;
    await setFeeds(feeds);
  } catch (error) {
    sheetError =
      error instanceof Error
        ? error.message
        : "The dashboard sheet could not be read.";
    cardErrors = {
      cinc: sheetError,
      referrals: sheetError,
      anniversaries: sheetError,
      birthdays: sheetError,
      emails: sheetError,
    };
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

  const payload: DashboardPayload = {
    feeds,
    sheetError,
    openHouseError,
    cardErrors,
  };
  cacheGlobal.__areg_sheet_cache__ = { ...payload, at: Date.now() };
  return payload;
}

import {
  emptyFeeds,
  emptyOpsCards,
  sheetTabs,
  summarizeOpenHouses,
  type LiveFeeds,
  type OpsCardItem,
  type OpsCardKey,
  type OpsCards,
  type SheetCardErrors,
} from "@/lib/dashboard-data";
import { currentOpenHouseRows } from "@/lib/dashboard-text";
import { feedsFromSheetTables } from "@/lib/feeds-io";
import { reloadFeedsFromDisk, setFeeds } from "@/lib/bot-store";
import {
  formResponsesTab,
  loadServiceAccount,
  openHouseReadStats,
  openHouseRowsFromTable,
  openHouseSheetId,
  opsSheetId,
  readPublicCsv,
  readSpreadsheet,
  type OpenHouseReadStats,
  type SheetTab,
} from "@/lib/google-sheets";

/**
 * AREG Ops tabs, one per dashboard card.
 * Change `tab` here when the sheet names are confirmed.
 * `columns` stays null until the headers are confirmed, so the card stays empty
 * instead of guessing. `upcoming` / `latest` are the row limits those cards will use.
 */
export const OPS_CARD_TABS: Record<
  OpsCardKey,
  {
    tab: string;
    columns: Record<string, string> | null;
    upcoming?: number;
    latest?: number;
  }
> = {
  clientAnniversaries: { tab: "Anniversaries", columns: null, upcoming: 10 },
  clientBirthdays: { tab: "Birthdays", columns: null, upcoming: 10 },
  referralExchange: { tab: "Referrals", columns: null, latest: 6 },
  outstandingEmails: { tab: "Outstanding Emails", columns: null },
  docusignDrafts: { tab: "DocuSign Drafts", columns: null },
  subjectRemovals: { tab: "Upcoming Subject Removals", columns: null },
  completionDates: { tab: "Upcoming Completion Dates", columns: null },
};

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

function findOpsTab(tabs: SheetTab[], tabName: string): SheetTab | undefined {
  const wanted = tabName.trim().toLowerCase();
  return tabs.find((tab) => tab.title.trim().toLowerCase() === wanted);
}

/**
 * Read one configured card. With `columns` still null, filled tabs stay hidden
 * and the card shows its empty state.
 */
export function readOpsCard(tabs: SheetTab[], key: OpsCardKey): OpsCardItem[] {
  const config = OPS_CARD_TABS[key];
  const tab = findOpsTab(tabs, config.tab);
  if (config.columns == null || !tab || tab.error || tab.rows.length <= 1) return [];
  return [];
}

export function opsCardsFromTabs(tabs: SheetTab[]): OpsCards {
  const cards = emptyOpsCards();
  (Object.keys(OPS_CARD_TABS) as OpsCardKey[]).forEach((key) => {
    cards[key] = readOpsCard(tabs, key);
  });
  return cards;
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
  tabs: SheetTab[];
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
      tabs: [],
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
        tabs: [],
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
      tabs,
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
    tabs: [],
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
  feeds.opsCards = opsCardsFromTabs(tables.tabs);
  return { feeds, cardErrors: tables.cardErrors };
}

function unmappedRowError(title: string, stats: OpenHouseReadStats): string | null {
  if (stats.nonEmptyDataRowCount > 0 && stats.mappedRowCount === 0) {
    return `Google returned ${stats.nonEmptyDataRowCount} filled rows on “${title}”, but none mapped to Name, Weekend date, Saturday, Sunday, or Notes.`;
  }
  return null;
}

async function readOpenHouseForm(): Promise<
  | { rows: ReturnType<typeof openHouseRowsFromTable> }
  | { missing: true }
  | { error: string }
> {
  const id = openHouseSheetId();
  if (!id) return { missing: true };
  try {
    if (!loadServiceAccount()) {
      const table = await readPublicCsv(id, 0);
      const stats = openHouseReadStats(table);
      const unmapped = unmappedRowError("the public sheet", stats);
      if (unmapped) return { error: unmapped };
      return { rows: openHouseRowsFromTable(table) };
    }
    const tabs = await readSpreadsheet(id);
    const tab = formResponsesTab(tabs);
    if (!tab) {
      return { error: "Google opened the open-house sheet, but it has no tabs." };
    }
    if (tab.error) return { error: tab.error };
    if (tab.rows.length === 0) {
      const range = tab.reportedRange ? ` Range Google reported: ${tab.reportedRange}.` : "";
      return {
        error: tab.valuesKeyPresent
          ? `Google opened the “${tab.title}” tab but the values array was empty.${range}`
          : `Google opened the “${tab.title}” tab but the response had no values array.${range}`,
      };
    }
    const stats = openHouseReadStats(tab.rows);
    const unmapped = unmappedRowError(tab.title, stats);
    if (unmapped) return { error: unmapped };
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
  let opsReadFailed = false;
  try {
    const synced = await syncFeedsFromGoogleSheet();
    feeds = synced.feeds;
    cardErrors = synced.cardErrors;
  } catch (error) {
    opsReadFailed = true;
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
    const rows = currentOpenHouseRows(openHouse.rows);
    feeds = {
      ...feeds,
      openHouse: {
        rows,
        summary: summarizeOpenHouses(rows),
      },
    };
  }

  if (!opsReadFailed) {
    await setFeeds(feeds);
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

function idTail(id: string): string | null {
  if (!id) return null;
  return id.slice(-6);
}

/** Counts and errors for the open-house sheet. No names, dates, or notes. */
export async function debugOpenHouse(): Promise<Record<string, unknown>> {
  const openId = openHouseSheetId();
  const opsId = opsSheetId();
  let serviceAccountConfigured = false;
  let serviceAccountError: string | null = null;
  try {
    serviceAccountConfigured = Boolean(loadServiceAccount());
  } catch (error) {
    serviceAccountError =
      error instanceof Error ? error.message : "The service account JSON could not be read.";
  }
  const cached = cacheGlobal.__areg_sheet_cache__;
  const base: Record<string, unknown> = {
    openHouseSheetIdSet: Boolean(openId),
    opsSheetIdSet: Boolean(opsId),
    readsOpenHouseSheetId: true,
    sameIdAsOpsSheet: Boolean(openId) && openId === opsId,
    openHouseSheetIdTail: idTail(openId),
    openHouseSheetIdLength: openId.length,
    opsSheetIdTail: idTail(opsId),
    serviceAccountConfigured,
    serviceAccountError,
    cacheBypassed: true,
    cachedOpenHouseRowCount: cached?.feeds.openHouse.rows.length ?? null,
    cachedOpenHouseError: cached?.openHouseError ?? null,
    cachedAgeMs: cached ? Date.now() - cached.at : null,
  };
  if (!openId) {
    return {
      ...base,
      error: "OPEN_HOUSE_SHEET_ID is not set, so the reader never calls Google for this card.",
      valuesRowCount: 0,
      mappedRowCount: 0,
    };
  }
  if (serviceAccountError) {
    return { ...base, error: serviceAccountError, valuesRowCount: 0, mappedRowCount: 0 };
  }

  try {
    if (!serviceAccountConfigured) {
      const table = await readPublicCsv(openId, 0);
      const stats = openHouseReadStats(table);
      return {
        ...base,
        source: "public-csv",
        ...stats,
        emptyResultSwallowed:
          stats.nonEmptyDataRowCount > 0 && stats.mappedRowCount === 0,
        error: unmappedRowError("the public sheet", stats),
      };
    }
    const tabs = await readSpreadsheet(openId);
    const tab = formResponsesTab(tabs);
    if (!tab) {
      return {
        ...base,
        source: "service-account",
        tabCount: 0,
        tabTitles: [],
        error: "Google opened the open-house sheet, but it has no tabs.",
        valuesRowCount: 0,
        mappedRowCount: 0,
      };
    }
    const stats = openHouseReadStats(tab.rows);
    return {
      ...base,
      source: "service-account",
      tabCount: tabs.length,
      tabTitles: tabs.map((item) => item.title),
      tabTitle: tab.title,
      choseFormResponses1: tab.title.trim().toLowerCase() === "form responses 1",
      reportedRange: tab.reportedRange ?? null,
      valuesKeyPresent: tab.valuesKeyPresent ?? false,
      tabError: tab.error ?? null,
      ...stats,
      emptyResultSwallowed:
        !tab.error && stats.nonEmptyDataRowCount > 0 && stats.mappedRowCount === 0,
      error: tab.error ?? unmappedRowError(tab.title, stats),
    };
  } catch (error) {
    return {
      ...base,
      error:
        error instanceof Error
          ? error.message
          : "The open house form sheet could not be read.",
      valuesRowCount: 0,
      mappedRowCount: 0,
    };
  }
}

import {
  emptyFeeds,
  emptyOpsCards,
  LIVE_FEED_POLL_MS,
  type OpsCardItem,
  type OpsCardKey,
  sheetTabs,
  summarizeOpenHouses,
  type LiveFeeds,
  type SheetCardErrors,
} from "@/lib/dashboard-data";
import { currentOpenHouseRows } from "@/lib/dashboard-text";
import {
  cincGroupsFromTable,
  findNamedTab,
  FIRM_TODO_TAB,
  OPS_CARD_TABS,
  opsCardsFromTabs,
  transactionChecklistItems,
} from "@/lib/ops-card-rows";
import { feedsFromSheetTables } from "@/lib/feeds-io";
import { reloadFeedsFromDisk, setFeeds } from "@/lib/bot-store";
import {
  FORM_RESPONSES_TAB,
  formResponsesTab,
  isQuotaError,
  loadServiceAccount,
  openHouseReadStats,
  openHouseRowsFromTable,
  openHouseSheetId,
  opsSheetId,
  readNamedTabs,
  readPublicCsv,
  sheetNow,
  sheetReadsSince,
  transactionsSheetId,
  type OpenHouseReadStats,
  type SheetTab,
  type WantedTab,
} from "@/lib/google-sheets";

export { OPS_CARD_TABS };

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

type DashboardStore = {
  payload: DashboardPayload | null;
  fetchedAt: number;
  nextAttemptAt: number;
  backoffMs: number;
  inFlight: Promise<DashboardPayload> | null;
};

const BACKOFF_START_MS = 60_000;
const BACKOFF_MAX_MS = 5 * 60_000;

function dashboardStore(): DashboardStore {
  const g = globalThis as typeof globalThis & { __areg_dashboard_cache__?: DashboardStore };
  if (!g.__areg_dashboard_cache__) {
    g.__areg_dashboard_cache__ = {
      payload: null,
      fetchedAt: 0,
      nextAttemptAt: 0,
      backoffMs: BACKOFF_START_MS,
      inFlight: null,
    };
  }
  return g.__areg_dashboard_cache__;
}

export function resetDashboardCacheForTests() {
  const g = globalThis as typeof globalThis & { __areg_dashboard_cache__?: DashboardStore };
  delete g.__areg_dashboard_cache__;
}

function opsWantedTabs(): WantedTab[] {
  const legacy: WantedTab[] = [
    { title: "CINC", sheetId: sheetTabs.CINC },
    { title: "Anniversaries", sheetId: sheetTabs.Anniversaries },
    { title: "Birthdays", sheetId: sheetTabs.Birthdays },
    { title: "Referrals", sheetId: sheetTabs.Referrals },
    { title: "OpenHouses", sheetId: sheetTabs.OpenHouses },
    { title: "OutstandingEmails", sheetId: sheetTabs.OutstandingEmails },
  ];
  const cards = Object.values(OPS_CARD_TABS).map((spec) => ({ title: spec.tab }));
  return [...legacy, ...cards];
}

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
      tabs = await readNamedTabs(id, opsWantedTabs(), { discoverMissing: true });
    } catch (error) {
      if (isQuotaError(error)) throw error;
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
      cinc: cinc.error,
      anniversaries: anniversaries.error,
      birthdays: birthdays.error,
      referrals: referrals.error,
      emails: outstandingEmails.error,
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
  const built = opsCardsFromTabs(tables.tabs, {
    sheetError: tables.tabs.length === 0 ? tables.cardErrors.cinc : null,
  });
  feeds.opsCards = built.cards;
  feeds.opsCardNotes = built.notes;
  feeds.cincGroups = cincGroupsFromTable(tables.cinc);
  return { feeds, cardErrors: tables.cardErrors };
}

export function patchCachedOpsItem(id: string, patch: Partial<OpsCardItem> | null) {
  const box = dashboardStore();
  if (!box.payload) return;
  const cards = { ...box.payload.feeds.opsCards };
  (Object.keys(cards) as OpsCardKey[]).forEach((key) => {
    cards[key] = patch
      ? cards[key].map((item) => (item.id === id ? { ...item, ...patch } : item))
      : cards[key].filter((item) => item.id !== id);
  });
  box.payload = {
    ...box.payload,
    feeds: { ...box.payload.feeds, opsCards: cards },
  };
}

async function readFirmTransactionTodos(): Promise<{
  items: LiveFeeds["opsCards"]["todos"];
  error: string | null;
}> {
  const id = transactionsSheetId();
  if (!id) {
    return {
      items: [],
      error:
        "TRANSACTIONS_SHEET_ID is not set, so firm-transaction checklist items are not on this card.",
    };
  }
  try {
    if (!loadServiceAccount()) {
      return {
        items: [],
        error: "Add GOOGLE_SERVICE_ACCOUNT_JSON to read the firm-transaction checklist.",
      };
    }
    const tabs = await readNamedTabs(id, [{ title: FIRM_TODO_TAB }]);
    const tab = findNamedTab(tabs, FIRM_TODO_TAB);
    if (!tab || tab.error) return { items: [], error: tab?.error ?? null };
    return { items: transactionChecklistItems(tab.rows), error: null };
  } catch (error) {
    if (isQuotaError(error)) throw error;
    return {
      items: [],
      error:
        error instanceof Error
          ? error.message
          : "The firm-transaction sheet could not be read.",
    };
  }
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
    const tabs = await readNamedTabs(id, [{ title: FORM_RESPONSES_TAB }]);
    const tab = formResponsesTab(tabs);
    if (!tab || tab.error) return tab?.error ? { error: tab.error } : { rows: [] };
    if (tab.rows.length === 0) return { rows: [] };
    const stats = openHouseReadStats(tab.rows);
    const unmapped = unmappedRowError(tab.title, stats);
    if (unmapped) return { error: unmapped };
    return { rows: openHouseRowsFromTable(tab.rows) };
  } catch (error) {
    if (isQuotaError(error)) throw error;
    return {
      error:
        error instanceof Error
          ? error.message
          : "The open house form sheet could not be read.",
    };
  }
}

function quietPayload(): DashboardPayload {
  return {
    feeds: emptyFeeds(),
    sheetError: null,
    openHouseError: null,
    cardErrors: blankCardErrors(),
  };
}

function failurePayload(message: string): DashboardPayload {
  const notes: LiveFeeds["opsCardNotes"] = {};
  (Object.keys(emptyOpsCards()) as OpsCardKey[]).forEach((key) => {
    notes[key] = message;
  });
  return {
    feeds: {
      ...emptyFeeds(),
      opsCardNotes: notes,
    },
    sheetError: message,
    openHouseError: message,
    cardErrors: {
      cinc: message,
      referrals: message,
      anniversaries: message,
      birthdays: message,
      emails: message,
    },
  };
}

async function buildPayload(): Promise<DashboardPayload> {
  let feeds = emptyFeeds();
  let sheetError: string | null = null;
  let cardErrors = blankCardErrors();
  let opsReadFailed = false;
  try {
    const synced = await syncFeedsFromGoogleSheet();
    feeds = synced.feeds;
    cardErrors = synced.cardErrors;
  } catch (error) {
    if (isQuotaError(error)) throw error;
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
    const notes: LiveFeeds["opsCardNotes"] = { ...feeds.opsCardNotes };
    (Object.keys(emptyOpsCards()) as OpsCardKey[]).forEach((key) => {
      notes[key] = sheetError ?? "The dashboard sheet could not be read.";
    });
    feeds = { ...feeds, opsCards: emptyOpsCards(), opsCardNotes: notes };
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

  const firmTodos = await readFirmTransactionTodos();
  const todoNote = [feeds.opsCardNotes?.todos, firmTodos.error].filter(Boolean).join(" ");
  feeds = {
    ...feeds,
    opsCards: {
      ...feeds.opsCards,
      todos: [...(feeds.opsCards?.todos ?? []), ...firmTodos.items],
    },
    opsCardNotes: {
      ...feeds.opsCardNotes,
      ...(todoNote ? { todos: todoNote } : {}),
    },
  };

  if (!opsReadFailed) await setFeeds(feeds);

  return { feeds, sheetError, openHouseError, cardErrors };
}

async function refreshDashboard(): Promise<DashboardPayload> {
  const box = dashboardStore();
  try {
    const payload = await buildPayload();
    box.payload = payload;
    box.fetchedAt = sheetNow();
    box.nextAttemptAt = sheetNow() + LIVE_FEED_POLL_MS;
    box.backoffMs = BACKOFF_START_MS;
    return payload;
  } catch (error) {
    if (isQuotaError(error)) {
      box.nextAttemptAt = sheetNow() + box.backoffMs;
      box.backoffMs = Math.min(box.backoffMs * 2, BACKOFF_MAX_MS);
      if (box.payload) return box.payload;
      const quiet = quietPayload();
      box.payload = quiet;
      box.fetchedAt = sheetNow();
      return quiet;
    }
    const message =
      error instanceof Error ? error.message : "The dashboard sheet could not be read.";
    const failed = failurePayload(message);
    box.payload = failed;
    box.fetchedAt = sheetNow();
    box.nextAttemptAt = sheetNow() + LIVE_FEED_POLL_MS;
    box.backoffMs = BACKOFF_START_MS;
    return failed;
  }
}

export async function loadDashboardFeeds(): Promise<DashboardPayload> {
  const box = dashboardStore();
  const now = sheetNow();
  if (box.payload && now < box.nextAttemptAt) return box.payload;
  if (box.inFlight) return box.inFlight;

  let settle!: {
    resolve: (value: DashboardPayload) => void;
    reject: (error: unknown) => void;
  };
  const run = new Promise<DashboardPayload>((resolve, reject) => {
    settle = { resolve, reject };
  });
  box.inFlight = run;
  void refreshDashboard()
    .then((payload) => settle.resolve(payload))
    .catch((error: unknown) => settle.reject(error))
    .finally(() => {
      if (box.inFlight === run) box.inFlight = null;
    });
  return run;
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
  const payload = await loadDashboardFeeds();
  const box = dashboardStore();
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
    cacheBypassed: false,
    cachedOpenHouseRowCount: payload.feeds.openHouse.rows.length,
    cachedOpenHouseError: payload.openHouseError,
    cachedAgeMs: box.fetchedAt ? sheetNow() - box.fetchedAt : null,
    sheetReadsLastMinute: sheetReadsSince(sheetNow() - 60_000),
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
    const tabs = await readNamedTabs(openId, [{ title: FORM_RESPONSES_TAB }]);
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

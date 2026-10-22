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
import { calendarToday, currentOpenHouseRows, type CalendarDay } from "@/lib/dashboard-text";
import {
  cincFromTable,
  dateColumnPresent,
  dealsFromDateSheet,
  EMAIL_DRAFT_SHEET_HEADERS,
  EMAIL_DRAFTS_TAB,
  findNamedTab,
  FIRM_TODO_TAB,
  GBP_TAB,
  GOOGLE_BUSINESS_QUEUE_TAB,
  GOOGLE_BUSINESS_TAB,
  MARKETING_QUEUE_HEADERS,
  MARKETING_QUEUE_TAB,
  mergeKeyDeals,
  mergeImportantDateGroups,
  transactionDateLines,
  type NotepadKeyDate,
  OPS_CARD_TABS,
  opsCardsFromTabs,
  removableDocusignRows,
  removableOpenHouseRows,
  sheetDataRowCount,
  sheetTabMatches,
  sortScheduledOpenHouseItems,
  transactionChecklistItems,
  type KeyDeal,
} from "@/lib/ops-card-rows";
import { readGmailDrafts } from "@/lib/gmail-drafts";
import { feedsFromSheetTables } from "@/lib/feeds-io";
import { awaitStoreReady, listDrafts, reloadFeedsFromDisk, setFeeds } from "@/lib/bot-store";
import {
  deleteSheetRows,
  ensureSheetTab,
  FORM_RESPONSES_TAB,
  formResponsesTab,
  isQuotaError,
  listSheetTitles,
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

export type TabHealth = {
  spreadsheet: "ops" | "transactions" | "open-house";
  tab: string;
  found: boolean;
  rowCount: number;
  dataRowCount: number;
  parsedCount: number;
  error: string | null;
  note: string;
};

export type DashboardHealth = {
  checkedAt: string;
  serviceAccountConfigured: boolean;
  opsSheetIdSet: boolean;
  transactionsSheetIdSet: boolean;
  openHouseSheetIdSet: boolean;
  tabs: TabHealth[];
  unreadTransactionTabs: string[];
  emailDraftJobs: number;
};

type DashboardStore = {
  payload: DashboardPayload | null;
  fetchedAt: number;
  nextAttemptAt: number;
  backoffMs: number;
  inFlight: Promise<DashboardPayload> | null;
  health: DashboardHealth | null;
  todoColumns: Record<string, number> | null;
  todoTabTitle: string;
  openHouseColumns: Record<string, number> | null;
  openHouseTabTitle: string;
  keyDateColumns: Record<string, number> | null;
  keyDateHeaderRow: number;
  keyDateTabTitle: string;
  notepadKeyDates: NotepadKeyDate[];
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
      health: null,
      todoColumns: null,
      todoTabTitle: OPS_CARD_TABS.todos.tab,
      openHouseColumns: null,
      openHouseTabTitle: OPS_CARD_TABS.scheduledOpenHouses.tab,
      keyDateColumns: null,
      keyDateHeaderRow: 1,
      keyDateTabTitle: OPS_CARD_TABS.completionDates.tab,
      notepadKeyDates: [],
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
    { title: "OpenHouses" },
    { title: "OutstandingEmails", sheetId: sheetTabs.OutstandingEmails },
  ];
  const cards = Object.values(OPS_CARD_TABS).map((spec) => ({ title: spec.tab }));
  const extra: WantedTab[] = [
    { title: "CINC Call History" },
    { title: EMAIL_DRAFTS_TAB },
    { title: "Email Drafts" },
    { title: GOOGLE_BUSINESS_QUEUE_TAB },
    { title: GOOGLE_BUSINESS_TAB },
    { title: GBP_TAB },
    { title: MARKETING_QUEUE_TAB },
  ];
  return [...legacy, ...cards, ...extra];
}

function bestCincTab(tabs: SheetTab[]): SheetTab | undefined {
  const matches = tabs.filter((tab) => /cinc/i.test(tab.title) && !tab.missing);
  const byGid = matches.find(
    (tab) => tab.sheetId === sheetTabs.CINC && sheetDataRowCount(tab.rows) > 0,
  );
  if (byGid) return byGid;
  const withRows = matches
    .filter((tab) => sheetDataRowCount(tab.rows) > 0)
    .sort((a, b) => sheetDataRowCount(b.rows) - sheetDataRowCount(a.rows));
  return withRows[0] ?? matches.find((tab) => tab.sheetId === sheetTabs.CINC) ?? matches[0];
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

async function ensureDashboardTabs(spreadsheetId: string): Promise<string | null> {
  try {
    await ensureSheetTab(spreadsheetId, MARKETING_QUEUE_TAB, MARKETING_QUEUE_HEADERS);
    await ensureSheetTab(spreadsheetId, EMAIL_DRAFTS_TAB, EMAIL_DRAFT_SHEET_HEADERS);
    return null;
  } catch (error) {
    if (isQuotaError(error)) throw error;
    return error instanceof Error ? error.message : "A dashboard tab could not be created.";
  }
}

/** Drop the DocuSign test draft and leftover blank OpenHouses rows. */
async function pruneLeftoverRows(spreadsheetId: string, tabs: SheetTab[]): Promise<string | null> {
  const problems: string[] = [];
  for (const tab of tabs) {
    if (tab.missing || tab.error || tab.sheetId == null || tab.sheetId < 0) continue;
    const rows = sheetTabMatches(tab.title, OPS_CARD_TABS.docusignDrafts.tab)
      ? removableDocusignRows(tab.rows)
      : sheetTabMatches(tab.title, OPS_CARD_TABS.scheduledOpenHouses.tab)
        ? removableOpenHouseRows(tab.rows)
        : [];
    if (!rows.length) continue;
    try {
      await deleteSheetRows(spreadsheetId, tab.sheetId, rows);
      [...rows].sort((a, b) => b - a).forEach((row) => {
        if (row >= 1 && row <= tab.rows.length) tab.rows.splice(row - 1, 1);
      });
    } catch (error) {
      if (isQuotaError(error)) throw error;
      problems.push(error instanceof Error ? error.message : `Could not clean ${tab.title}.`);
    }
  }
  return problems.length ? problems.join(" ") : null;
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
  setupError: string | null;
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
      setupError: null,
    };
  }

  if (loadServiceAccount()) {
    let tabs: SheetTab[] = [];
    let setupError: string | null = null;
    try {
      setupError = await ensureDashboardTabs(id);
      tabs = await readNamedTabs(id, opsWantedTabs(), { discoverMissing: true });
      const pruneError = await pruneLeftoverRows(id, tabs);
      setupError = [setupError, pruneError].filter(Boolean).join(" ") || null;
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
        setupError: null,
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
      setupError,
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
    setupError: null,
  };
}

export async function syncFeedsFromGoogleSheet(): Promise<{
  feeds: LiveFeeds;
  cardErrors: SheetCardErrors;
  tabs: SheetTab[];
  todoColumns: Record<string, number> | null;
  todoTabTitle: string;
  openHouseColumns: Record<string, number> | null;
  openHouseTabTitle: string;
  keyDateColumns: Record<string, number> | null;
  keyDateHeaderRow: number;
  keyDateTabTitle: string;
  importantDatesDraft: string;
  notepadKeyDates: NotepadKeyDate[];
}> {
  const tables = await opsTables();
  const feeds = feedsFromSheetTables({
    cinc: tables.cinc,
    anniversaries: tables.anniversaries,
    birthdays: tables.birthdays,
    referrals: tables.referrals,
    openHouses: [],
    outstandingEmails: tables.outstandingEmails,
  });
  const today = calendarToday();
  const built = opsCardsFromTabs(tables.tabs, {
    sheetError: tables.tabs.length === 0 ? tables.cardErrors.cinc : null,
    today,
  });
  feeds.opsCards = built.cards;
  feeds.opsCardNotes = built.notes;
  feeds.sheetEmailDrafts = built.sheetEmailDrafts;
  feeds.importantDates = built.importantDates;
  feeds.importantDatesDraft = built.importantDatesDraft;
  if (tables.setupError) {
    const parts = tables.setupError.split(/(?<=\.)\s+/);
    const take = (pattern: RegExp) => parts.filter((part) => pattern.test(part)).join(" ");
    const google = take(/MarketingQueue|GoogleBusiness/i);
    const email = take(/EmailDrafts/i);
    const removed = take(/delete that row/i);
    if (google) {
      feeds.opsCardNotes.googleBusiness = [feeds.opsCardNotes.googleBusiness, google].filter(Boolean).join(" ");
    }
    if (email) feeds.emailDraftNote = email;
    if (removed) {
      feeds.opsCardNotes.scheduledOpenHouses = [feeds.opsCardNotes.scheduledOpenHouses, removed]
        .filter(Boolean)
        .join(" ");
      feeds.opsCardNotes.docusignDrafts = [feeds.opsCardNotes.docusignDrafts, removed].filter(Boolean).join(" ");
    }
  }
  const cincTab = bestCincTab(tables.tabs);
  const cincRows = cincTab && sheetDataRowCount(cincTab.rows) > 0 ? cincTab.rows : tables.cinc;
  const cincTitle = cincTab?.title || "CINC";
  if (cincTab?.error || tables.cardErrors.cinc) {
    feeds.cincGroups = [];
    feeds.cincNote = cincTab?.error || tables.cardErrors.cinc || "";
  } else {
    const read = cincFromTable(cincRows, cincTitle, today);
    feeds.cincGroups = read.groups;
    feeds.cincNote = read.note;
  }
  return {
    feeds,
    cardErrors: tables.cardErrors,
    tabs: tables.tabs,
    todoColumns: built.todoColumns,
    todoTabTitle: findNamedTab(tables.tabs, OPS_CARD_TABS.todos.tab)?.title || OPS_CARD_TABS.todos.tab,
    openHouseColumns: built.openHouseColumns,
    openHouseTabTitle:
      findNamedTab(tables.tabs, OPS_CARD_TABS.scheduledOpenHouses.tab)?.title ||
      OPS_CARD_TABS.scheduledOpenHouses.tab,
    keyDateColumns: built.keyDateColumns,
    keyDateHeaderRow: built.keyDateHeaderRow,
    keyDateTabTitle:
      findNamedTab(tables.tabs, OPS_CARD_TABS.completionDates.tab)?.title ||
      OPS_CARD_TABS.completionDates.tab,
    importantDatesDraft: built.importantDatesDraft,
    notepadKeyDates: built.notepadKeyDates,
  };
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
  const drafts = box.payload.feeds.sheetEmailDrafts ?? [];
  box.payload = {
    ...box.payload,
    feeds: {
      ...box.payload.feeds,
      opsCards: cards,
      sheetEmailDrafts: patch
        ? drafts.map((item) => (item.id === id ? { ...item, ...patch } : item))
        : drafts.filter((item) => item.id !== id),
    },
  };
  publishDashboardFeeds();
}

function publishDashboardFeeds() {
  const box = dashboardStore();
  if (!box.payload) return;
  void setFeeds(box.payload.feeds);
}

export function appendCachedOpsItem(key: OpsCardKey, item: OpsCardItem) {
  const box = dashboardStore();
  if (!box.payload) return;
  const cards = { ...box.payload.feeds.opsCards };
  const next = [...(cards[key] ?? []), item];
  cards[key] = key === "scheduledOpenHouses" ? sortScheduledOpenHouseItems(next) : next;
  box.payload = {
    ...box.payload,
    feeds: { ...box.payload.feeds, opsCards: cards },
  };
  publishDashboardFeeds();
}

export function cachedTodoColumns(): Record<string, number> | null {
  return dashboardStore().todoColumns;
}

export function cachedTodoTabTitle(): string {
  return dashboardStore().todoTabTitle || OPS_CARD_TABS.todos.tab;
}

export function cachedOpenHouseColumns(): Record<string, number> | null {
  return dashboardStore().openHouseColumns;
}

export function cachedOpenHouseTabTitle(): string {
  return dashboardStore().openHouseTabTitle || OPS_CARD_TABS.scheduledOpenHouses.tab;
}

export function cachedKeyDateColumns(): Record<string, number> | null {
  return dashboardStore().keyDateColumns;
}

export function cachedKeyDateHeaderRow(): number {
  return dashboardStore().keyDateHeaderRow || 1;
}

export function cachedKeyDateTabTitle(): string {
  return dashboardStore().keyDateTabTitle || OPS_CARD_TABS.completionDates.tab;
}

export function rememberKeyDateColumn(key: string, column: number) {
  const box = dashboardStore();
  box.keyDateColumns = { ...(box.keyDateColumns ?? {}), [key]: column };
}

export function cachedImportantDates(): { label: string; notes: string[] }[] {
  return dashboardStore().payload?.feeds.importantDates ?? [];
}

export function cachedNotepadKeyDates(): NotepadKeyDate[] {
  return dashboardStore().notepadKeyDates ?? [];
}

export function rememberNotepadKeyDates(rows: NotepadKeyDate[]) {
  dashboardStore().notepadKeyDates = rows;
}

export function rememberImportantDatesDraft(text: string) {
  const box = dashboardStore();
  box.payload = box.payload
    ? { ...box.payload, feeds: { ...box.payload.feeds, importantDatesDraft: text } }
    : box.payload;
  publishDashboardFeeds();
}

export function appendCachedImportantDates(additions: { day: CalendarDay; note: string }[]) {
  const box = dashboardStore();
  if (!box.payload || !additions.length) return;
  const today = calendarToday();
  const importantDates = mergeImportantDateGroups(
    box.payload.feeds.importantDates ?? [],
    additions,
    today,
  );
  box.payload = {
    ...box.payload,
    feeds: { ...box.payload.feeds, importantDates },
  };
  publishDashboardFeeds();
}

export function dashboardHealth(): DashboardHealth | null {
  return dashboardStore().health;
}

function tabHealth(
  spreadsheet: TabHealth["spreadsheet"],
  tab: SheetTab | undefined,
  fallbackTitle: string,
  parsedCount: number,
  note: string,
): TabHealth {
  const rows = tab?.rows ?? [];
  const missing = tab?.missing === true || !tab;
  return {
    spreadsheet,
    tab: tab?.title || fallbackTitle,
    found: Boolean(tab) && !tab?.missing,
    rowCount: rows.length,
    dataRowCount: sheetDataRowCount(rows),
    parsedCount,
    error: tab?.error ?? null,
    note: tab?.error ? tab.error : missing ? `No data in ${fallbackTitle}.` : note,
  };
}

type TransactionRead = {
  items: OpsCardItem[];
  error: string | null;
  completion: KeyDeal[];
  health: TabHealth[];
  unreadTitles: string[];
};

async function readTransactionsSheet(today: ReturnType<typeof calendarToday>): Promise<TransactionRead> {
  const empty = (error: string | null): TransactionRead => ({
    items: [],
    error,
    completion: [],
    health: [
      {
        spreadsheet: "transactions",
        tab: FIRM_TODO_TAB,
        found: false,
        rowCount: 0,
        dataRowCount: 0,
        parsedCount: 0,
        error,
        note: error ?? "",
      },
    ],
    unreadTitles: [],
  });
  const id = transactionsSheetId();
  if (!id) {
    return empty("TRANSACTIONS_SHEET_ID is not set, so firm-transaction checklist items are not on this card.");
  }
  if (!loadServiceAccount()) {
    return empty("Add GOOGLE_SERVICE_ACCOUNT_JSON to read the firm-transaction checklist.");
  }
  try {
    const listed = await listSheetTitles(id);
    const wanted = new Map<string, string>();
    const take = (title: string) => {
      const found = listed.find((tab) => sheetTabMatches(tab.title, title));
      if (found) wanted.set(found.title.toLowerCase(), found.title);
    };
    take(FIRM_TODO_TAB);
    const tabs = wanted.size
      ? await readNamedTabs(id, [...wanted.values()].map((title) => ({ title })))
      : [];
    const firm = findNamedTab(tabs, FIRM_TODO_TAB);
    const completionSources = tabs.filter(
      (tab) => !/notary/i.test(tab.title) && dateColumnPresent(tab.rows, "completion"),
    );
    const completion = mergeKeyDeals(
      completionSources.map((tab) => dealsFromDateSheet(tab.rows, today, "completion", tab.title)),
    );
    const health = tabs.map((tab) => {
      const firmCount = sheetTabMatches(tab.title, FIRM_TODO_TAB)
        ? transactionChecklistItems(tab.rows).length
        : 0;
      const note = sheetTabMatches(tab.title, FIRM_TODO_TAB) ? "Checklist only." : "";
      return tabHealth("transactions", tab, tab.title, firmCount, note);
    });
    const unreadTitles = listed
      .map((tab) => tab.title)
      .filter((title) => !wanted.has(title.toLowerCase()));
    return {
      items: firm && !firm.error ? transactionChecklistItems(firm.rows) : [],
      error: firm?.error ?? null,
      completion,
      health,
      unreadTitles,
    };
  } catch (error) {
    if (isQuotaError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "The firm-transaction sheet could not be read.";
    return empty(message);
  }
}

function unmappedRowError(title: string, stats: OpenHouseReadStats): string | null {
  if (stats.nonEmptyDataRowCount > 0 && stats.mappedRowCount === 0) {
    return `Google returned ${stats.nonEmptyDataRowCount} filled rows on “${title}”, but none mapped to Name, Weekend date, Saturday, Sunday, or Notes.`;
  }
  return null;
}

async function readOpenHouseForm(): Promise<
  | { rows: ReturnType<typeof openHouseRowsFromTable>; title: string; rawCount: number }
  | { missing: true }
  | { error: string; title?: string }
> {
  const id = openHouseSheetId();
  if (!id) return { missing: true };
  try {
    if (!loadServiceAccount()) {
      const table = await readPublicCsv(id, 0);
      const stats = openHouseReadStats(table);
      const unmapped = unmappedRowError("the public sheet", stats);
      if (unmapped) return { error: unmapped, title: "the public sheet" };
      return { rows: openHouseRowsFromTable(table), title: "the public sheet", rawCount: stats.nonEmptyDataRowCount };
    }
    const tabs = await readNamedTabs(id, [{ title: FORM_RESPONSES_TAB }]);
    const tab = formResponsesTab(tabs);
    if (!tab || tab.error) {
      return tab?.error ? { error: tab.error, title: tab.title } : { rows: [], title: FORM_RESPONSES_TAB, rawCount: 0 };
    }
    if (tab.rows.length === 0) return { rows: [], title: tab.title, rawCount: 0 };
    const stats = openHouseReadStats(tab.rows);
    const unmapped = unmappedRowError(tab.title, stats);
    if (unmapped) return { error: unmapped, title: tab.title };
    return { rows: openHouseRowsFromTable(tab.rows), title: tab.title, rawCount: stats.nonEmptyDataRowCount };
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

function parsedForOpsTab(title: string, feeds: LiveFeeds): number {
  const cards = feeds.opsCards ?? emptyOpsCards();
  if (sheetTabMatches(title, OPS_CARD_TABS.clientAnniversaries.tab)) return cards.clientAnniversaries.length;
  if (sheetTabMatches(title, OPS_CARD_TABS.clientBirthdays.tab)) return cards.clientBirthdays.length;
  if (/referral/i.test(title)) return cards.referralExchange.length;
  if (/outstanding/i.test(title)) return cards.outstandingEmails.length;
  if (/docusign/i.test(title)) return cards.docusignDrafts.length;
  if (sheetTabMatches(title, OPS_CARD_TABS.subjectRemovals.tab)) return cards.subjectRemovals.length;
  if (sheetTabMatches(title, OPS_CARD_TABS.completionDates.tab)) return feeds.transactionDates?.length ?? cards.completionDates.length;
  if (sheetTabMatches(title, OPS_CARD_TABS.todos.tab)) return cards.todos.length;
  if (sheetTabMatches(title, OPS_CARD_TABS.scheduledOpenHouses.tab)) {
    return cards.scheduledOpenHouses?.length ?? 0;
  }
  if (sheetTabMatches(title, EMAIL_DRAFTS_TAB)) return feeds.sheetEmailDrafts?.length ?? 0;
  if (
    sheetTabMatches(title, MARKETING_QUEUE_TAB) ||
    sheetTabMatches(title, GOOGLE_BUSINESS_QUEUE_TAB) ||
    sheetTabMatches(title, GOOGLE_BUSINESS_TAB) ||
    sheetTabMatches(title, GBP_TAB)
  ) {
    return cards.googleBusiness?.length ?? 0;
  }
  if (/cinc/i.test(title)) return feeds.cincGroups?.length ?? 0;
  return 0;
}

async function rememberHealth(input: {
  feeds: LiveFeeds;
  opsTabs: SheetTab[];
  sheetError: string | null;
  opsNote: string | null;
  openHouseError: string | null;
  openHouseTitle: string;
  openHouseRaw: number;
  openHouseParsed: number;
  transactions: TransactionRead;
}) {
  await awaitStoreReady();
  const opsSeen = new Set<string>();
  const opsHealth: TabHealth[] = [];
  if (input.opsTabs.length === 0) {
    const note = input.sheetError || input.opsNote || "No AREG Ops tabs were read.";
    opsHealth.push({
      spreadsheet: "ops",
      tab: "AREG Ops",
      found: false,
      rowCount: 0,
      dataRowCount: 0,
      parsedCount: 0,
      error: input.sheetError || input.opsNote,
      note,
    });
  }
  input.opsTabs.forEach((tab) => {
    const key = tab.title.trim().toLowerCase();
    if (opsSeen.has(key)) return;
    opsSeen.add(key);
    const dataRows = sheetDataRowCount(tab.rows);
    const parsed = parsedForOpsTab(tab.title, input.feeds);
    let note = "";
    if (tab.missing || dataRows === 0) note = `No data in ${tab.title}.`;
    else if (/cinc/i.test(tab.title) && input.feeds.cincNote && parsed === 0) note = input.feeds.cincNote;
    else if (parsed === 0) note = `${tab.title} has ${dataRows} rows, but none matched this card.`;
    opsHealth.push(tabHealth("ops", tab, tab.title, parsed, note));
  });
  const openHouseHealth: TabHealth = {
    spreadsheet: "open-house",
    tab: input.openHouseTitle || FORM_RESPONSES_TAB,
    found: !input.openHouseError && input.openHouseTitle !== "",
    rowCount: input.openHouseRaw,
    dataRowCount: input.openHouseRaw,
    parsedCount: input.openHouseParsed,
    error: input.openHouseError,
    note: input.openHouseError
      ? input.openHouseError
      : input.openHouseParsed === 0
        ? `No data in ${input.openHouseTitle || FORM_RESPONSES_TAB}.`
        : "",
  };
  const health: DashboardHealth = {
    checkedAt: new Date().toISOString(),
    serviceAccountConfigured: (() => {
      try {
        return Boolean(loadServiceAccount());
      } catch {
        return false;
      }
    })(),
    opsSheetIdSet: Boolean(opsSheetId()),
    transactionsSheetIdSet: Boolean(transactionsSheetId()),
    openHouseSheetIdSet: Boolean(openHouseSheetId()),
    tabs: [...opsHealth, ...input.transactions.health, openHouseHealth],
    unreadTransactionTabs: input.transactions.unreadTitles,
    emailDraftJobs: listDrafts().length,
  };
  dashboardStore().health = health;
  console.info(
    `[dashboard] ${health.tabs
      .map(
        (tab) =>
          `${tab.spreadsheet}/${tab.tab}: rows=${tab.dataRowCount} parsed=${tab.parsedCount}${
            tab.error ? " error" : ""
          }${tab.note ? " note" : ""}`,
      )
      .join(" | ")}`,
  );
}

async function buildPayload(): Promise<DashboardPayload> {
  let feeds = emptyFeeds();
  let sheetError: string | null = null;
  let cardErrors = blankCardErrors();
  let opsReadFailed = false;
  let opsTabs: SheetTab[] = [];
  let todoColumns: Record<string, number> | null = null;
  let todoTabTitle = OPS_CARD_TABS.todos.tab;
  let openHouseColumns: Record<string, number> | null = null;
  let openHouseTabTitle = OPS_CARD_TABS.scheduledOpenHouses.tab;
  let keyDateColumns: Record<string, number> | null = null;
  let keyDateHeaderRow = 1;
  let keyDateTabTitle = OPS_CARD_TABS.completionDates.tab;
  let notepadKeyDates: NotepadKeyDate[] = [];
  const today = calendarToday();
  try {
    const synced = await syncFeedsFromGoogleSheet();
    feeds = synced.feeds;
    cardErrors = synced.cardErrors;
    opsTabs = synced.tabs;
    todoColumns = synced.todoColumns;
    todoTabTitle = synced.todoTabTitle;
    openHouseColumns = synced.openHouseColumns;
    openHouseTabTitle = synced.openHouseTabTitle;
    keyDateColumns = synced.keyDateColumns;
    keyDateHeaderRow = synced.keyDateHeaderRow;
    keyDateTabTitle = synced.keyDateTabTitle;
    notepadKeyDates = synced.notepadKeyDates;
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
  let openHouseTitle = FORM_RESPONSES_TAB;
  let openHouseRaw = 0;
  let openHouseParsed = feeds.openHouse?.rows?.length ?? 0;
  const openHouse = await readOpenHouseForm();
  if ("missing" in openHouse) {
    openHouseTitle = "";
    if ((feeds.openHouse?.rows ?? []).length === 0) {
      openHouseError =
        "Open house sign-ups are not connected. Add OPEN_HOUSE_SHEET_ID (the spreadsheet id of the Google Form’s responses sheet) and share that sheet with the same Google service account as the dashboard.";
    }
  } else if ("error" in openHouse) {
    openHouseError = openHouse.error;
    openHouseTitle = openHouse.title || FORM_RESPONSES_TAB;
  } else {
    const rows = currentOpenHouseRows(openHouse.rows);
    openHouseTitle = openHouse.title;
    openHouseRaw = openHouse.rawCount;
    openHouseParsed = rows.length;
    feeds = {
      ...feeds,
      openHouse: {
        rows,
        summary: summarizeOpenHouses(rows),
      },
    };
  }

  const transactions = await readTransactionsSheet(today);
  const keyDates = findNamedTab(opsTabs, OPS_CARD_TABS.completionDates.tab);
  const subjectTab = findNamedTab(opsTabs, OPS_CARD_TABS.subjectRemovals.tab);
  const transactionDates = transactionDateLines(
    subjectTab && !subjectTab.error ? subjectTab.rows : [],
    keyDates && !keyDates.error ? keyDates.rows : [],
    transactions.completion,
    today,
  );
  feeds = {
    ...feeds,
    transactionDates,
    opsCards: {
      ...feeds.opsCards,
      todos: feeds.opsCards?.todos ?? [],
      completionDates: transactionDates.map((text, index) => ({ id: `transaction-date-${index}`, text })),
    },
  };
  dashboardStore().todoColumns = todoColumns;
  dashboardStore().todoTabTitle = todoTabTitle;
  dashboardStore().openHouseColumns = openHouseColumns;
  dashboardStore().openHouseTabTitle = openHouseTabTitle;
  dashboardStore().keyDateColumns = keyDateColumns;
  dashboardStore().keyDateHeaderRow = keyDateHeaderRow;
  dashboardStore().keyDateTabTitle = keyDateTabTitle;
  dashboardStore().notepadKeyDates = notepadKeyDates;

  const gmailDrafts = await readGmailDrafts();
  if (gmailDrafts.ok) {
    feeds = { ...feeds, sheetEmailDrafts: gmailDrafts.items, emailDraftNote: "" };
  } else if (gmailDrafts.reason === "error") {
    feeds = { ...feeds, emailDraftNote: [feeds.emailDraftNote, gmailDrafts.message].filter(Boolean).join(" ") };
  }

  if (!opsReadFailed) await setFeeds(feeds);

  await rememberHealth({
    feeds,
    opsTabs,
    sheetError,
    opsNote: cardErrors.cinc,
    openHouseError,
    openHouseTitle,
    openHouseRaw,
    openHouseParsed,
    transactions,
  });

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

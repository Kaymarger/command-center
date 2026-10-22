export type OutstandingEmail = {
  id: string;
  type:
    | "accepted-offer"
    | "after-subject-removal"
    | "review-request"
    | "listing-is-live"
    | string;
  label: string;
  detail: string;
};

export type BotId = "cinc" | "work-routine" | "google-forms";

export type BotLink = {
  id: BotId;
  label: string;
  href: string;
  description: string;
};

export const bots: Record<BotId, BotLink> = {
  cinc: {
    id: "cinc",
    label: "CINC Bot",
    href: "/bots/cinc",
    description: "Pulls agent call history from CINC in real time.",
  },
  "work-routine": {
    id: "work-routine",
    label: "Work Routine Bot",
    href: "/bots/work-routine",
    description:
      "Syncs referral exchange, client anniversaries, and birthdays (IXACT).",
  },
  "google-forms": {
    id: "google-forms",
    label: "Google Forms Bot",
    href: "/bots/google-forms",
    description: "Summarizes open-house availability form responses.",
  },
};

export type CincAgentStats = {
  id: string;
  agent: string;
  lastCall: string;
  wtd: { calls: number; connected: number; appointments: number };
  mtd: { calls: number; connected: number; appointments: number };
  ytd: { calls: number; connected: number; appointments: number };
};

export type IxactItem = {
  id: string;
  name: string;
  date: string;
  note: string;
};

export type ReferralItem = {
  id: string;
  name: string;
  status: "active" | "history";
  direction: string;
  meta: string;
};

export type OpenHouseRow = {
  agent: string;
  /** Weekend date from the form, or the time window from the ops sheet. */
  window: string;
  coverage: string;
  saturday?: string;
  sunday?: string;
  notes?: string;
};

export type OpsCardKey =
  | "clientAnniversaries"
  | "clientBirthdays"
  | "referralExchange"
  | "outstandingEmails"
  | "docusignDrafts"
  | "subjectRemovals"
  | "completionDates"
  | "todos"
  | "scheduledOpenHouses"
  | "googleBusiness";

export type SheetCellRef = {
  spreadsheet: "ops" | "transactions";
  tab: string;
  /** 1-based sheet row. */
  row: number;
  /** 0-based column index. */
  column: number;
};

export type OpsCardItem = {
  id: string;
  text: string;
  /** Extra text shown on hover or when the line is expanded. */
  detail?: string;
  /** Outstanding emails split a due list from the next 7 days. */
  section?: "due" | "upcoming";
  /** Cell a Skip (or Send) button writes. */
  sheet?: SheetCellRef;
  /** Value written by Skip. */
  skipValue?: "skipped" | "n/a";
  /** Gmail draft id for an outstanding-email Send. */
  draftId?: string;
  /** True once a send has been queued. */
  busy?: boolean;
  /** Bot named on the sheet row, when a Send or Delete should be queued there. */
  bot?: string;
  /** ISO time used to sort email drafts. */
  createdAt?: string;
  /** Hidden on To-Do's until Show all. Older than 30 days, or the deal is closed. */
  stale?: boolean;
  /** Address key used to tell whether a checklist row's deal is still open. */
  dealKey?: string;
};

export type CincCount = { label: string; value: number };

export type CincGroup = {
  agent: string;
  today: CincCount[];
  week: CincCount[];
  year: CincCount[];
};

export type OpsCards = Record<OpsCardKey, OpsCardItem[]>;

export function emptyOpsCards(): OpsCards {
  return {
    clientAnniversaries: [],
    clientBirthdays: [],
    referralExchange: [],
    outstandingEmails: [],
    docusignDrafts: [],
    subjectRemovals: [],
    completionDates: [],
    todos: [],
    scheduledOpenHouses: [],
    googleBusiness: [],
  };
}

export type SheetCardErrors = {
  cinc: string | null;
  referrals: string | null;
  anniversaries: string | null;
  birthdays: string | null;
  emails: string | null;
};

export type LiveFeeds = {
  updatedAt: string;
  source: "empty" | "sheet" | "webhook" | "mixed";
  cincAgents: CincAgentStats[];
  cincGroups: CincGroup[];
  openHouse: { summary: string; rows: OpenHouseRow[] };
  referrals: { active: ReferralItem[]; history: ReferralItem[] };
  anniversaries: IxactItem[];
  birthdays: IxactItem[];
  outstandingEmails: OutstandingEmail[];
  opsCards: OpsCards;
  opsCardNotes: Partial<Record<OpsCardKey, string>>;
  /** Plain-English note for the CINC card when the tab is empty or unreadable. */
  cincNote?: string;
  /** Email drafts read from an EmailDrafts tab, newest first. */
  sheetEmailDrafts?: OpsCardItem[];
  /** KeyDates rows, soonest day first. */
  importantDates?: { label: string; notes: string[] }[];
  /** Shown on Email Drafts when the EmailDrafts tab could not be created. */
  emailDraftNote?: string;
};

export const AREG_OPS_SHEET_ID = process.env.AREG_OPS_SHEET_ID?.trim() ?? "";

export const AREG_OPS_SHEET_URL = AREG_OPS_SHEET_ID
  ? `https://docs.google.com/spreadsheets/d/${AREG_OPS_SHEET_ID}/edit`
  : "";

/** Browser poll and server sheet cache. Kept at a minute so Google stays under the read quota. */
export const LIVE_FEED_POLL_MS = 60_000;

export const sheetTabs = {
  CINC: 2029945079,
  Anniversaries: 344359764,
  Birthdays: 1367901010,
  Referrals: 1045399196,
  OpenHouses: 1665715339,
  OutstandingEmails: 54498409,
} as const;

export function emptyFeeds(source: LiveFeeds["source"] = "empty"): LiveFeeds {
  return {
    updatedAt: new Date().toISOString(),
    source,
    cincAgents: [],
    cincGroups: [],
    openHouse: { summary: "", rows: [] },
    referrals: { active: [], history: [] },
    anniversaries: [],
    birthdays: [],
    outstandingEmails: [],
    opsCards: emptyOpsCards(),
    opsCardNotes: {},
    cincNote: "",
    sheetEmailDrafts: [],
    importantDates: [],
    emailDraftNote: "",
  };
}

export function feedHasRows(feeds: LiveFeeds): boolean {
  return (
    feeds.cincAgents.length > 0 ||
    (feeds.cincGroups?.length ?? 0) > 0 ||
    feeds.openHouse.rows.length > 0 ||
    feeds.referrals.active.length > 0 ||
    feeds.referrals.history.length > 0 ||
    feeds.anniversaries.length > 0 ||
    feeds.birthdays.length > 0 ||
    feeds.outstandingEmails.length > 0 ||
    (feeds.importantDates?.length ?? 0) > 0 ||
    Object.values(feeds.opsCards ?? {}).some((items) => items.length > 0)
  );
}

/**
 * A blank snapshot (the empty feeds file on disk) must not replace rows
 * already loaded from Google.
 */
export function preferLiveFeeds(current: LiveFeeds, incoming: LiveFeeds): LiveFeeds {
  if (!feedHasRows(incoming) && feedHasRows(current)) return current;
  return incoming;
}

export function summarizeOpenHouses(rows: OpenHouseRow[]): string {
  if (!rows.length) return "";
  const saturday = rows.filter((row) => /^(yes|y|true|available)$/i.test(row.saturday ?? "")).length;
  const sunday = rows.filter((row) => /^(yes|y|true|available)$/i.test(row.sunday ?? "")).length;
  if (saturday || sunday) {
    return `${rows.length} responses · ${saturday} available Saturday · ${sunday} available Sunday.`;
  }
  return `${rows.length} responses.`;
}

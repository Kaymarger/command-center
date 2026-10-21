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
  | "todos";

export type OpsCardItem = {
  id: string;
  text: string;
  /** Outstanding emails split a due list from the next 7 days. */
  section?: "due" | "upcoming";
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
  openHouse: { summary: string; rows: OpenHouseRow[] };
  referrals: { active: ReferralItem[]; history: ReferralItem[] };
  anniversaries: IxactItem[];
  birthdays: IxactItem[];
  outstandingEmails: OutstandingEmail[];
  opsCards: OpsCards;
  opsCardNotes: Partial<Record<OpsCardKey, string>>;
};

export const AREG_OPS_SHEET_ID = process.env.AREG_OPS_SHEET_ID?.trim() ?? "";

export const AREG_OPS_SHEET_URL = AREG_OPS_SHEET_ID
  ? `https://docs.google.com/spreadsheets/d/${AREG_OPS_SHEET_ID}/edit`
  : "";

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
    openHouse: { summary: "", rows: [] },
    referrals: { active: [], history: [] },
    anniversaries: [],
    birthdays: [],
    outstandingEmails: [],
    opsCards: emptyOpsCards(),
    opsCardNotes: {},
  };
}

export function feedHasRows(feeds: LiveFeeds): boolean {
  return (
    feeds.cincAgents.length > 0 ||
    feeds.openHouse.rows.length > 0 ||
    feeds.referrals.active.length > 0 ||
    feeds.referrals.history.length > 0 ||
    feeds.anniversaries.length > 0 ||
    feeds.birthdays.length > 0 ||
    feeds.outstandingEmails.length > 0 ||
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

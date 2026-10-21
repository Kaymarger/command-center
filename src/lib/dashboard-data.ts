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
  window: string;
  coverage: string;
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
  };
}

export function summarizeOpenHouses(rows: OpenHouseRow[]): string {
  if (!rows.length) return "";
  const available = rows.filter((r) =>
    /available/i.test(r.coverage)
  ).length;
  const limited = rows.filter((r) => /limited/i.test(r.coverage)).length;
  const unavailable = rows.filter((r) =>
    /unavail/i.test(r.coverage)
  ).length;
  return `${rows.length} agents on the form · ${available} available · ${limited} limited · ${unavailable} unavailable.`;
}

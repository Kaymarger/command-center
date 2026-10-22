import {
  emptyOpsCards,
  type CincGroup,
  type OpsCardItem,
  type OpsCardKey,
  type OpsCards,
  type SheetCellRef,
} from "@/lib/dashboard-data";
import {
  addCalendarDays,
  calendarDateFromCell,
  calendarToday,
  compareCalendarDays,
  firstCalendarDate,
  formatLongDate,
  formatMonthDay,
  formatWeekday,
  nextAnnualDate,
  subtractMonths,
  type CalendarDay,
} from "@/lib/dashboard-text";
import type { SheetTab } from "@/lib/google-sheets";

/**
 * AREG Ops tab names and columns.
 * Subject removals come only from the SubjectRemovals tab.
 * Completion dates still come from KeyDates.
 * Firm-transaction checklist rows come from TRANSACTIONS_SHEET_ID.
 */
export const OPS_CARD_TABS: Record<
  Exclude<OpsCardKey, "googleBusiness">,
  { tab: string; columns: readonly string[]; upcoming?: number; latest?: number }
> = {
  clientAnniversaries: {
    tab: "Anniversaries",
    columns: ["name", "date", "note"],
    upcoming: 10,
  },
  clientBirthdays: {
    tab: "Birthdays",
    columns: ["name", "date", "note"],
    upcoming: 10,
  },
  referralExchange: {
    tab: "ReferralExchangeOnCall",
    columns: ["week_start", "agent", "phone", "set_on", "note"],
    latest: 6,
  },
  outstandingEmails: {
    tab: "OutstandingEmails",
    columns: ["address", "email_type", "due_date", "draft_id", "status", "checked_at"],
  },
  docusignDrafts: {
    tab: "DocuSignDrafts",
    columns: ["created_at", "address", "envelope_type", "signers", "envelope_subject", "status", "requested_by", "bot"],
  },
  subjectRemovals: {
    tab: "SubjectRemovals",
    columns: ["address", "subject_removal_date", "status", "note", "source_email_date", "updated_at"],
  },
  completionDates: {
    tab: "KeyDates",
    columns: ["address", "side", "agent", "subject_removal_date", "completion_date", "possession_date", "source"],
  },
  todos: {
    tab: "ToDos",
    columns: ["due_date", "item", "address", "owner_bot", "status"],
  },
  scheduledOpenHouses: {
    tab: "OpenHouses",
    columns: ["date", "start_time", "end_time", "address", "host_agent", "notes", "status", "created_at"],
  },
};

export const SCHEDULED_OPEN_HOUSE_HEADERS = [
  "date",
  "start_time",
  "end_time",
  "address",
  "host_agent",
  "notes",
  "status",
  "created_at",
] as const;

export const FIRM_TODO_TAB = "Firm Transactions To Dos";
export const EMAIL_DRAFTS_TAB = "EmailDrafts";
export const EMAIL_DRAFT_SHEET_HEADERS = [
  "subject",
  "body",
  "to",
  "status",
  "created_at",
  "bot",
  "draft_id",
] as const;
export const GOOGLE_BUSINESS_TAB = "Google Business Profile";
export const GOOGLE_BUSINESS_QUEUE_TAB = "GoogleBusiness";
export const GOOGLE_BUSINESS_HEADERS = [
  "scheduled_date",
  "type",
  "text",
  "status",
  "created_at",
] as const;
export const GBP_TAB = "GBP";
/** The transactions spreadsheet is titled this. A tab with the same name is read when it exists. */
export const SR_CLOSING_TAB = "Copy of SR & Closing Dates";

const NAME_HEADERS = ["name", "client", "client_name", "full_name", "person"];
const ANNUAL_DATE_HEADERS = [
  "date",
  "birthday",
  "birthdate",
  "birth_date",
  "anniversary",
  "anniversary_date",
  "move_in_date",
  "move_in",
];
const ADDRESS_HEADERS = ["address", "property", "property_address", "transactions", "street"];
const SUBJECT_DATE_HEADERS = ["subject_removal_date", "subject_removal", "sr_date", "sr", "subject"];
const COMPLETION_DATE_HEADERS = ["completion_date", "completion", "closing_date", "closing"];

const FIRM_CHECKS: { column: string; sentence: (who: string) => string }[] = [
  { column: "firm_email", sentence: (who) => `Send the firm email for ${who}.` },
  { column: "compl_email", sentence: (who) => `Send the completion email for ${who}.` },
  { column: "review_email", sentence: (who) => `Send the review email for ${who}.` },
  { column: "website", sentence: (who) => `Add ${who} to the website.` },
  { column: "mailchimp", sentence: (who) => `Add ${who} to Mailchimp.` },
  { column: "ixact", sentence: (who) => `Add ${who} to IXACT.` },
  { column: "calendar", sentence: (who) => `Add ${who} to the calendar.` },
];

function normHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findNamedTab(tabs: SheetTab[], tabName: string): SheetTab | undefined {
  const exact = tabs.find(
    (tab) => tab.title.trim().toLowerCase() === tabName.trim().toLowerCase(),
  );
  if (exact) return exact;
  const wanted = normTitle(tabName);
  return tabs.find((tab) => normTitle(tab.title) === wanted);
}

function headerIndex(rows: string[][], markers: string[]): number {
  const wanted = markers.map(normHeader);
  const found = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    return wanted.every((marker) => headers.includes(marker));
  });
  return found >= 0 ? found : 0;
}

function recordsFrom(rows: string[][], markers: string[]): Record<string, string>[] {
  return locateRows(rows, markers).items.map((item) => item.record);
}

function locateRows(rows: string[][], markers: string[]): {
  columns: Record<string, number>;
  items: { rowNumber: number; record: Record<string, string> }[];
} {
  if (!rows.length) return { columns: {}, items: [] };
  const index = headerIndex(rows, markers);
  const headers = (rows[index] ?? []).map(normHeader);
  const columns: Record<string, number> = {};
  headers.forEach((key, column) => {
    if (key && columns[key] == null) columns[key] = column;
  });
  const items = rows
    .slice(index + 1)
    .map((row, offset) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (!key) return;
        record[key] = (row[column] ?? "").trim();
      });
      return { rowNumber: index + 2 + offset, record };
    })
    .filter((item) => Object.values(item.record).some(Boolean));
  return { columns, items };
}

function cellRef(
  spreadsheet: SheetCellRef["spreadsheet"],
  tab: string,
  row: number,
  column: number | undefined,
): SheetCellRef | undefined {
  if (column == null || column < 0) return undefined;
  return { spreadsheet, tab, row, column };
}

function field(record: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[normHeader(key)];
    if (value) return value;
  }
  return "";
}

function closedStatus(status: string): boolean {
  return /^(sent|skipped|done|completed|complete|cancelled|canceled|voided|closed)$/i.test(
    status.trim(),
  );
}

function item(
  id: string,
  text: string,
  extra?: Partial<Omit<OpsCardItem, "id" | "text">>,
): OpsCardItem {
  return { id, text, ...extra };
}

function annualHeaderIndex(rows: string[][]): number {
  const found = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    const hasName = headers.some((header) => NAME_HEADERS.includes(header));
    const hasDate = headers.some(
      (header) => ANNUAL_DATE_HEADERS.includes(header) || /birth|annivers|move/.test(header),
    );
    return hasName && hasDate;
  });
  return found >= 0 ? found : headerIndex(rows, ["name", "date"]);
}

function annualRows(
  rows: string[][],
  today: CalendarDay,
  limit: number,
  prefix: string,
): OpsCardItem[] {
  if (!rows.length) return [];
  const index = annualHeaderIndex(rows);
  const headers = (rows[index] ?? []).map(normHeader);
  const dated = rows
    .slice(index + 1)
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (key) record[key] = (row[column] ?? "").trim();
      });
      return record;
    })
    .filter((record) => Object.values(record).some(Boolean))
    .map((record) => {
      const name = field(record, ...NAME_HEADERS);
      const rawDate = field(record, ...ANNUAL_DATE_HEADERS);
      const parsed = calendarDateFromCell(rawDate, today.year);
      const upcoming = parsed ? nextAnnualDate(parsed.month, parsed.day, today) : null;
      return { name, note: field(record, "note", "notes", "agent", "address"), upcoming };
    })
    .filter((row): row is { name: string; note: string; upcoming: CalendarDay } =>
      Boolean(row.name && row.upcoming),
    )
    .sort((a, b) => compareCalendarDays(a.upcoming, b.upcoming))
    .slice(0, limit);
  return dated.map((row, index) =>
    item(
      `${prefix}-${index}`,
      [row.name, formatLongDate(row.upcoming), row.note].filter(Boolean).join(" · "),
    ),
  );
}

function referralRows(rows: string[][], today: CalendarDay): OpsCardItem[] {
  const cutoff = subtractMonths(today, 3);
  return recordsFrom(rows, ["agent", "week_start"])
    .map((record) => ({
      agent: field(record, "agent"),
      phone: field(record, "phone"),
      note: field(record, "note", "notes"),
      week: firstCalendarDate(field(record, "week_start"), today.year),
    }))
    .filter(
      (row): row is typeof row & { week: CalendarDay } =>
        Boolean(row.agent && row.week && compareCalendarDays(row.week, cutoff) >= 0),
    )
    .sort((a, b) => compareCalendarDays(b.week, a.week))
    .map((row) =>
      item(`referral-${row.week.year}-${row.week.month}-${row.week.day}-${row.agent}`, `${formatMonthDay(row.week)} · ${row.agent}`, {
        detail: [row.phone, row.note].filter(Boolean).join(" · ") || undefined,
      }),
    );
}

function emailLabel(type: string): string {
  const value = type.trim().toLowerCase();
  if (value === "firm") return "firm email";
  if (value === "completion") return "completion email";
  if (value === "review") return "review email";
  if (value === "pre-completion" || value === "precompletion") return "pre-completion email";
  return type.trim();
}

function emailRows(rows: string[][], today: CalendarDay, tabTitle = OPS_CARD_TABS.outstandingEmails.tab): OpsCardItem[] {
  const horizon = addCalendarDays(today, 7);
  const located = locateRows(rows, ["address", "due_date"]);
  const open = located.items
    .map(({ rowNumber, record }) => ({
      rowNumber,
      address: field(record, "address"),
      type: field(record, "email_type"),
      status: field(record, "status"),
      draftId: field(record, "draft_id"),
      due: firstCalendarDate(field(record, "due_date"), today.year),
    }))
    .filter((row) => row.address && row.due && !/^(sent|skipped)$/i.test(row.status.trim()));

  const due = open
    .filter((row) => compareCalendarDays(row.due!, today) <= 0)
    .sort((a, b) => compareCalendarDays(b.due!, a.due!));
  const upcoming = open
    .filter((row) => {
      const compared = compareCalendarDays(row.due!, today);
      return compared > 0 && compareCalendarDays(row.due!, horizon) <= 0;
    })
    .sort((a, b) => compareCalendarDays(a.due!, b.due!));

  const line = (row: (typeof open)[number], section: OpsCardItem["section"]) => {
    const sending = /^sending$/i.test(row.status.trim());
    const label = emailLabel(row.type) || "email";
    return item(`email-${row.rowNumber}`, `${row.address} · ${label}`, {
      section,
      detail: `Due ${formatLongDate(row.due!)}${row.draftId ? ` · draft ${row.draftId}` : ""}`,
      draftId: sending ? undefined : row.draftId || undefined,
      busy: sending,
      skipValue: "skipped",
      sheet: cellRef("ops", tabTitle, row.rowNumber, located.columns.status),
    });
  };
  return [...due.map((row) => line(row, "due")), ...upcoming.map((row) => line(row, "upcoming"))];
}

export function shortAddress(address: string): string {
  const street = address.split(",")[0]?.trim() ?? address.trim();
  return street
    .replace(
      /\s+(avenue|ave|street|st|road|rd|drive|dr|boulevard|blvd|court|ct|place|pl|crescent|cres|way|lane|ln)\.?$/i,
      "",
    )
    .trim();
}

export function botIdFromSheet(value: string): string {
  const text = value.trim().toLowerCase();
  if (/transaction/.test(text)) return "transaction";
  if (/listing/.test(text)) return "listings";
  if (/manager/.test(text)) return "manager";
  if (/work|routine/.test(text)) return "work-routine";
  return "";
}

/** "subject_removal" → "Subject Removal". Underscores become spaces, then each word is title case. */
export function humanizeType(value: string): string {
  const cleaned = value.trim().replace(/_+/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""))
    .join(" ");
}

function citesNotaryWatch(record: Record<string, string>): boolean {
  return Object.values(record).some((value) => /notary_watch/i.test(value));
}

function isForestHillsTest(record: Record<string, string>, rawRow: string[]): boolean {
  const blob = [...Object.values(record), ...rawRow].join(" ");
  return /931\s*forest\s*hills/i.test(blob) && /\btest\b/i.test(blob);
}

function draftRows(rows: string[][], today: CalendarDay, tabTitle = OPS_CARD_TABS.docusignDrafts.tab): OpsCardItem[] {
  const located = locateRows(rows, ["address", "status"]);
  return located.items
    .map(({ rowNumber, record }) => ({
      rowNumber,
      address: field(record, "address"),
      type: field(record, "envelope_type"),
      signers: field(record, "signers"),
      subject: field(record, "envelope_subject"),
      requestedBy: field(record, "requested_by"),
      status: field(record, "status"),
      bot: field(record, "bot"),
      created: calendarDateFromCell(field(record, "created_at"), today.year),
    }))
    .filter((row) => row.address && /^draft$/i.test(row.status.trim()) && !isForestHillsTest(
      {
        address: row.address,
        envelope_type: row.type,
        envelope_subject: row.subject,
      },
      [row.address, row.type, row.subject],
    ))
    .sort((a, b) =>
      compareCalendarDays(
        b.created ?? { year: 0, month: 1, day: 1 },
        a.created ?? { year: 0, month: 1, day: 1 },
      ),
    )
    .map((row) => {
      const type = humanizeType(row.type) || "DocuSign";
      const text = `${type} - ${shortAddress(row.address)}`;
      const detail = [row.address, row.signers, row.subject, row.requestedBy ? `requested by ${row.requestedBy}` : ""]
        .filter(Boolean)
        .join(" · ");
      return item(`docusign-${row.rowNumber}`, text, {
        detail,
        bot: botIdFromSheet(row.bot),
        sheet: cellRef("ops", tabTitle, row.rowNumber, located.columns.status),
      });
    });
}

export type KeyDeal = {
  address: string;
  side: string;
  agent: string;
  source: string;
  date: CalendarDay;
  possession: CalendarDay | null;
};

export function addressKey(address: string): string {
  return address
    .split(",")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function notaryHeader(header: string): boolean {
  return /notary/.test(header);
}

function notaryRow(record: Record<string, string>): boolean {
  const type = field(record, "type", "event", "category", "date_type", "kind");
  if (/notary/i.test(type)) return true;
  const address = field(record, ...ADDRESS_HEADERS);
  return /notary/i.test(address);
}

function subjectHeader(header: string): boolean {
  if (notaryHeader(header)) return false;
  if (SUBJECT_DATE_HEADERS.includes(header)) return true;
  if (header === "s_r" || header.startsWith("sr_") || header.startsWith("s_r_")) return true;
  if (header.startsWith("subject")) return true;
  return false;
}

function completionHeader(header: string): boolean {
  if (notaryHeader(header)) return false;
  if (COMPLETION_DATE_HEADERS.includes(header)) return true;
  return /^(compl|closing)/.test(header) && !/email/.test(header);
}

function dateHeaderMatch(header: string, kind: "subject" | "completion"): boolean {
  return kind === "subject" ? subjectHeader(header) : completionHeader(header);
}

function findDealHeader(
  rows: string[][],
  kind: "subject" | "completion",
): { index: number; headers: string[]; dateHeader: string } | null {
  if (!rows.length) return null;
  for (let index = 0; index < Math.min(rows.length, 8); index += 1) {
    const headers = (rows[index] ?? []).map(normHeader);
    const hasAddress = headers.some((header) => ADDRESS_HEADERS.includes(header));
    const dateHeader = headers.find((header) => dateHeaderMatch(header, kind));
    if (hasAddress && dateHeader) return { index, headers, dateHeader };
  }
  return null;
}

/** True when the sheet has an address column and a non-notary date column for this card. */
export function dateColumnPresent(rows: string[][], kind: "subject" | "completion"): boolean {
  return findDealHeader(rows, kind) != null;
}

export function dealsFromDateSheet(
  rows: string[][],
  today: CalendarDay,
  kind: "subject" | "completion",
  sourceLabel = "",
): KeyDeal[] {
  const found = findDealHeader(rows, kind);
  if (!found) return [];
  const { index, headers, dateHeader } = found;
  return rows
    .slice(index + 1)
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (key) record[key] = (row[column] ?? "").trim();
      });
      return record;
    })
    .filter((record) => Object.values(record).some(Boolean) && !notaryRow(record))
    .map((record) => ({
      address: field(record, ...ADDRESS_HEADERS),
      side: field(record, "side", "listing_or_buyer", "listing_buyer"),
      agent: field(record, "agent", "agent_1"),
      source: field(record, "source") || sourceLabel,
      date: calendarDateFromCell(record[dateHeader] ?? "", today.year),
      possession: calendarDateFromCell(field(record, "possession_date", "possession"), today.year),
    }))
    .filter((row): row is KeyDeal => Boolean(row.address && row.date && compareCalendarDays(row.date, today) >= 0));
}

/** Keep one future date per address. The sooner date wins, and the other source stays in the line. */
export function mergeKeyDeals(lists: KeyDeal[][]): KeyDeal[] {
  const byAddress = new Map<string, KeyDeal>();
  lists.flat().forEach((deal) => {
    const key = addressKey(deal.address);
    if (!key) return;
    const existing = byAddress.get(key);
    if (!existing) {
      byAddress.set(key, deal);
      return;
    }
    const sooner = compareCalendarDays(deal.date, existing.date) <= 0 ? deal : existing;
    const later = sooner === deal ? existing : deal;
    const sources = [...new Set([sooner.source, later.source].filter(Boolean))];
    byAddress.set(key, {
      ...sooner,
      side: sooner.side || later.side,
      agent: sooner.agent || later.agent,
      possession: sooner.possession ?? later.possession,
      source: sources.join(" · "),
    });
  });
  return [...byAddress.values()];
}

const EXTENDED_SUBJECT_NOTE = "Extended – check addendum";

/** Upcoming rows from the SubjectRemovals tab. Removed and past dates stay off the card. */
export function subjectRemovalRows(
  rows: string[][],
  today: CalendarDay,
): { items: OpsCardItem[]; recognized: boolean } {
  if (!rows.length) return { items: [], recognized: false };
  const headerAt = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    return (
      headers.some((header) => ADDRESS_HEADERS.includes(header)) &&
      headers.some((header) => header === "subject_removal_date" || header === "subject_removal")
    );
  });
  if (headerAt < 0) return { items: [], recognized: false };
  const headers = (rows[headerAt] ?? []).map(normHeader);
  const items = rows
    .slice(headerAt + 1)
    .map((row, offset) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (key) record[key] = (row[column] ?? "").trim();
      });
      return { rowNumber: headerAt + 2 + offset, record };
    })
    .filter((entry) => Object.values(entry.record).some(Boolean))
    .map((entry) => ({
      rowNumber: entry.rowNumber,
      address: field(entry.record, ...ADDRESS_HEADERS),
      status: field(entry.record, "status").toLowerCase(),
      note: field(entry.record, "note", "notes"),
      sourceEmail: field(entry.record, "source_email_date"),
      date: calendarDateFromCell(field(entry.record, "subject_removal_date", "subject_removal"), today.year),
      notaryWatch: citesNotaryWatch(entry.record),
    }))
    .filter((row): row is typeof row & { date: CalendarDay } =>
      Boolean(
        row.address &&
          row.date &&
          !row.notaryWatch &&
          row.status !== "removed" &&
          compareCalendarDays(row.date, today) >= 0,
      ),
    )
    .sort((a, b) => compareCalendarDays(a.date, b.date) || a.address.localeCompare(b.address))
    .map((row) => {
      const place = shortAddress(row.address) || row.address;
      const extended = row.status === "extended";
      const text = [place, formatLongDate(row.date), extended ? EXTENDED_SUBJECT_NOTE : ""].filter(Boolean).join(" · ");
      const detail = [
        row.address,
        formatLongDate(row.date),
        extended ? EXTENDED_SUBJECT_NOTE : row.status ? row.status : "",
        row.note,
        row.sourceEmail ? `email ${row.sourceEmail}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return item(`subject-${row.rowNumber}`, text, { detail });
    });
  return { items, recognized: true };
}

const KEY_DATE_KINDS: { aliases: string[]; label: string }[] = [
  { aliases: ["subject_removal_date", "subject_removal", "sr_date", "sr"], label: "Subject removal" },
  { aliases: ["completion_date", "completion", "closing_date", "closing"], label: "Completion" },
  { aliases: ["possession_date", "possession"], label: "Possession" },
];

function keyDateTable(rows: string[][]): { headerAt: number; headers: string[] } | null {
  if (!rows.length) return null;
  const headerAt = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    return headers.some((header) => ADDRESS_HEADERS.includes(header));
  });
  if (headerAt < 0) return null;
  return { headerAt, headers: (rows[headerAt] ?? []).map(normHeader) };
}

/**
 * Addresses on KeyDates that still have a subject, completion, or possession
 * date within the last 30 days or later. Null when the tab has no date columns.
 * A deal missing from this set is treated as closed.
 */
export function openDealAddressKeys(rows: string[][], today: CalendarDay): Set<string> | null {
  const table = keyDateTable(rows);
  if (!table) return null;
  const kinds = KEY_DATE_KINDS.map((kind) => table.headers.find((header) => kind.aliases.includes(header))).filter(
    (key): key is string => Boolean(key),
  );
  if (!kinds.length) return null;
  const cutoff = addCalendarDays(today, -30);
  const keys = new Set<string>();
  rows.slice(table.headerAt + 1).forEach((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((key, column) => {
      if (key) record[key] = (row[column] ?? "").trim();
    });
    const address = field(record, ...ADDRESS_HEADERS);
    const key = addressKey(address);
    if (!key) return;
    const dates = kinds
      .map((header) => calendarDateFromCell(record[header] ?? "", today.year))
      .filter((day): day is CalendarDay => Boolean(day));
    if (!dates.length || dates.some((day) => compareCalendarDays(day, cutoff) >= 0)) keys.add(key);
  });
  return keys;
}

/** KeyDates addresses whose dates are all more than 30 days ago. */
export function closedDealAddressKeys(rows: string[][], today: CalendarDay): Set<string> | null {
  const open = openDealAddressKeys(rows, today);
  const table = keyDateTable(rows);
  if (!open || !table) return null;
  const closed = new Set<string>();
  rows.slice(table.headerAt + 1).forEach((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((key, column) => {
      if (key) record[key] = (row[column] ?? "").trim();
    });
    const key = addressKey(field(record, ...ADDRESS_HEADERS));
    if (key && !open.has(key)) closed.add(key);
  });
  return closed;
}

/** Upcoming KeyDates, soonest day first, one group per day. */
export function importantDatesFromKeySheet(
  rows: string[][],
  today: CalendarDay,
): { label: string; notes: string[] }[] {
  const table = keyDateTable(rows);
  if (!table) return [];
  const kinds = KEY_DATE_KINDS.flatMap((kind) => {
    const key = table.headers.find((header) => kind.aliases.includes(header));
    return key ? [{ key, label: kind.label }] : [];
  });
  if (!kinds.length) return [];
  const dated: { day: CalendarDay; note: string }[] = [];
  rows.slice(table.headerAt + 1).forEach((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((key, column) => {
      if (key) record[key] = (row[column] ?? "").trim();
    });
    if (!Object.values(record).some(Boolean)) return;
    const address = field(record, ...ADDRESS_HEADERS);
    if (!address) return;
    kinds.forEach((kind) => {
      const day = calendarDateFromCell(record[kind.key] ?? "", today.year);
      if (!day || compareCalendarDays(day, today) < 0) return;
      const who = [field(record, "side"), field(record, "agent", "agent_1")].filter(Boolean).join(", ");
      dated.push({ day, note: [address, kind.label, who].filter(Boolean).join(" · ") });
    });
  });
  dated.sort((a, b) => compareCalendarDays(a.day, b.day) || a.note.localeCompare(b.note));
  const groups: { label: string; notes: string[] }[] = [];
  dated.forEach((entry) => {
    const label = formatLongDate(entry.day);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.notes.push(entry.note);
    else groups.push({ label, notes: [entry.note] });
  });
  return groups;
}

export function dealItems(deals: KeyDeal[], kind: "subject" | "completion"): OpsCardItem[] {
  return [...deals]
    .sort((a, b) => compareCalendarDays(a.date, b.date) || a.address.localeCompare(b.address))
    .map((deal) => {
      const parts = [deal.address, deal.side, deal.agent, formatLongDate(deal.date), deal.source].filter(Boolean);
      const text = parts.join(" · ");
      const detail =
        kind === "completion" && deal.possession
          ? `${text} · possession ${formatLongDate(deal.possession)}`
          : text;
      return item(`${kind}-${addressKey(deal.address)}`, text, { detail });
    });
}

export function todoSentenceFromSheet(
  task: string,
  address: string,
  due: CalendarDay | null,
): string {
  const action = task.trim().replace(/[.]+$/, "");
  if (!action) return "";
  let sentence = action.charAt(0).toUpperCase() + action.slice(1);
  if (address) sentence += ` for ${address}`;
  if (due) sentence += ` by ${formatWeekday(due)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function todoRows(
  rows: string[][],
  today: CalendarDay,
  tabTitle = OPS_CARD_TABS.todos.tab,
  closedDeals: Set<string> | null = null,
): OpsCardItem[] {
  const cutoff = addCalendarDays(today, -30);
  const located = locateRows(rows, ["item"]);
  return located.items
    .map(({ rowNumber, record }) => ({
      rowNumber,
      task: field(record, "item"),
      address: field(record, "address"),
      status: field(record, "status"),
      due: firstCalendarDate(field(record, "due_date"), today.year),
    }))
    .filter((row) => row.task)
    .sort((a, b) => {
      if (a.due && b.due) return compareCalendarDays(a.due, b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    })
    .map((row) => {
      const text = todoSentenceFromSheet(row.task, row.address, row.due);
      const dealKey = addressKey(row.address);
      const dealClosed = Boolean(closedDeals && dealKey && closedDeals.has(dealKey));
      const stale =
        closedStatus(row.status) ||
        dealClosed ||
        (row.due != null && compareCalendarDays(row.due, cutoff) < 0);
      return item(`todo-${row.rowNumber}`, text, {
        detail: text,
        stale,
        dealKey: dealKey || undefined,
        skipValue: "skipped",
        sheet: cellRef("ops", tabTitle, row.rowNumber, located.columns.status),
      });
    })
    .filter((row) => row.text);
}

export function transactionChecklistItems(
  rows: string[][],
  openDeals: Set<string> | null = null,
): OpsCardItem[] {
  const located = locateRows(rows, ["transactions", "client_name"]);
  const items: OpsCardItem[] = [];
  located.items.forEach(({ rowNumber, record }) => {
    const property = field(record, "transactions", "transaction");
    const client = field(record, "client_name");
    const who =
      property && client && property.toLowerCase() !== client.toLowerCase()
        ? `${property} (${client})`
        : property || client;
    if (!who) return;
    const dealKey = addressKey(property || client);
    const stale = Boolean(openDeals && dealKey && !openDeals.has(dealKey));
    FIRM_CHECKS.forEach((check) => {
      if ((record[check.column] ?? "").trim()) return;
      const text = check.sentence(who);
      items.push(
        item(`firm-${rowNumber}-${check.column}`, text, {
          detail: text,
          stale,
          dealKey: dealKey || undefined,
          skipValue: "n/a",
          sheet: cellRef("transactions", FIRM_TODO_TAB, rowNumber, located.columns[check.column]),
        }),
      );
    });
  });
  return items;
}

const MONTH_TAB_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

/** Current month and the next month, as the transactions file names them ("OCTOBER 2026"). */
export function nearbyMonthTabs(today: CalendarDay): string[] {
  return [0, 1].map((offset) => {
    const utc = new Date(Date.UTC(today.year, today.month - 1 + offset, 1));
    return `${MONTH_TAB_NAMES[utc.getUTCMonth()]} ${utc.getUTCFullYear()}`;
  });
}

export function sheetTabMatches(left: string, right: string): boolean {
  return normTitle(left) === normTitle(right);
}

export function sheetDataRowCount(rows: string[][]): number {
  const start = rows.findIndex((row) => row.some((cell) => cell.trim()));
  if (start < 0) return 0;
  return rows.slice(start + 1).filter((row) => row.some((cell) => cell.trim())).length;
}

function isoDay(day: CalendarDay): string {
  const month = String(day.month).padStart(2, "0");
  const date = String(day.day).padStart(2, "0");
  return `${day.year}-${month}-${date}T12:00:00.000Z`;
}

const EMAIL_DRAFT_HEADERS = ["subject", "body", "email_body", "message", "draft"];
const EMAIL_META_HEADERS = ["to", "recipient", "bot", "status", "created_at", "date", "draft_id"];

function emailDraftHeaderIndex(rows: string[][]): number {
  const found = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    const hasBody = headers.some((header) => EMAIL_DRAFT_HEADERS.includes(header));
    const hasMeta = headers.some((header) => EMAIL_META_HEADERS.includes(header));
    return hasBody && hasMeta;
  });
  return found;
}

/** Last 10 open drafts on an EmailDrafts tab, newest first. */
export function emailDraftSheetRows(rows: string[][], today: CalendarDay, tabTitle: string): OpsCardItem[] {
  const index = emailDraftHeaderIndex(rows);
  if (index < 0) return [];
  const headers = (rows[index] ?? []).map(normHeader);
  const columns: Record<string, number> = {};
  headers.forEach((key, column) => {
    if (key && columns[key] == null) columns[key] = column;
  });
  const statusColumn = columns.status;
  return rows
    .slice(index + 1)
    .map((row, offset) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (key) record[key] = (row[column] ?? "").trim();
      });
      return { rowNumber: index + 2 + offset, record };
    })
    .filter((item) => Object.values(item.record).some(Boolean))
    .map((item) => ({
      ...item,
      subject: field(item.record, "subject", "email_subject"),
      body: field(item.record, "body", "email_body", "message", "draft"),
      to: field(item.record, "to", "recipient", "email"),
      status: field(item.record, "status"),
      bot: field(item.record, "bot"),
      draftId: field(item.record, "draft_id"),
      created: calendarDateFromCell(field(item.record, "created_at", "date", "created"), today.year),
    }))
    .filter((row) => (row.subject || row.body) && !closedStatus(row.status) && !/^deleted$/i.test(row.status))
    .sort((a, b) => {
      if (a.created && b.created) return compareCalendarDays(b.created, a.created);
      if (a.created) return -1;
      if (b.created) return 1;
      return b.rowNumber - a.rowNumber;
    })
    .slice(0, 10)
    .map((row) =>
      item(`sheet-draft-${row.rowNumber}`, row.subject || "Email draft", {
        detail: [row.to ? `To ${row.to}` : "", row.body].filter(Boolean).join("\n"),
        bot: botIdFromSheet(row.bot),
        draftId: row.draftId || undefined,
        createdAt: row.created ? isoDay(row.created) : "",
        sheet:
          statusColumn == null ? undefined : cellRef("ops", tabTitle, row.rowNumber, statusColumn),
      }),
    );
}

export function todoHeaderColumns(rows: string[][]): Record<string, number> | null {
  const located = locateRows(rows, ["item"]);
  if (located.columns.item == null) return null;
  return located.columns;
}

function googleBusinessQueueHeader(rows: string[][]): number {
  return rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    return (
      headers.includes("scheduled_date") &&
      headers.includes("text") &&
      headers.includes("status")
    );
  });
}

/** Queued rows on the GoogleBusiness tab. Other statuses stay off the card. */
export function googleBusinessQueueRows(rows: string[][], today: CalendarDay, tabTitle: string): OpsCardItem[] {
  const headerAt = googleBusinessQueueHeader(rows);
  if (headerAt < 0) return [];
  const headers = (rows[headerAt] ?? []).map(normHeader);
  return rows
    .slice(headerAt + 1)
    .map((row, offset) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (key) record[key] = (row[column] ?? "").trim();
      });
      return { rowNumber: headerAt + 2 + offset, record };
    })
    .filter((entry) => Object.values(entry.record).some(Boolean))
    .map((entry) => ({
      rowNumber: entry.rowNumber,
      status: field(entry.record, "status"),
      type: field(entry.record, "type"),
      text: field(entry.record, "text"),
      scheduled: calendarDateFromCell(field(entry.record, "scheduled_date"), today.year),
    }))
    .filter((row) => /^queued$/i.test(row.status.trim()) && (row.text || row.type))
    .sort((a, b) => {
      if (a.scheduled && b.scheduled) return compareCalendarDays(a.scheduled, b.scheduled);
      if (a.scheduled) return -1;
      if (b.scheduled) return 1;
      return a.rowNumber - b.rowNumber;
    })
    .map((row) => {
      const kind = humanizeType(row.type);
      const when = row.scheduled ? formatLongDate(row.scheduled) : "";
      const line = [when, kind, row.text].filter(Boolean).join(" · ");
      return item(`gbp-${tabTitle}-${row.rowNumber}`, `Google Business · ${line}`, {
        detail: [tabTitle, when, kind, row.text, row.status].filter(Boolean).join(" · "),
      });
    });
}

function googleBusinessRows(rows: string[][], tabTitle: string): OpsCardItem[] {
  if (!rows.length) return [];
  const headerAt = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    return headers.some((header) =>
      /status|update|post|summary|message|item|address|title|notes/.test(header),
    );
  });
  if (headerAt < 0) return [];
  const headers = (rows[headerAt] ?? []).map(normHeader);
  return rows
    .slice(headerAt + 1)
    .map((row, offset) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (key) record[key] = (row[column] ?? "").trim();
      });
      return { rowNumber: headerAt + 2 + offset, record };
    })
    .filter((item) => Object.values(item.record).some(Boolean))
    .map((item) => ({
      rowNumber: item.rowNumber,
      status: field(item.record, "status"),
      address: field(item.record, ...ADDRESS_HEADERS),
      text: field(
        item.record,
        "update",
        "post",
        "summary",
        "message",
        "item",
        "title",
        "notes",
        "note",
      ),
    }))
    .filter((row) => !closedStatus(row.status) && !/^(posted|published)$/i.test(row.status.trim()))
    .filter((row) => row.text || row.address)
    .map((row) => {
      const body = row.text || row.address;
      const line = row.address && row.text ? `${body} · ${shortAddress(row.address)}` : body;
      return item(`gbp-${tabTitle}-${row.rowNumber}`, `Google Business · ${line}`, {
        detail: [tabTitle, row.address, row.status].filter(Boolean).join(" · "),
      });
    });
}

function cincPeriod(header: string): "today" | "week" | "year" | "all" | "skip" {
  const value = header.toLowerCase();
  if (/today/.test(value)) return "today";
  if (/ytd|year/.test(value)) return "year";
  if (/wtd|week/.test(value)) return "week";
  if (/mtd|month/.test(value)) return "skip";
  return "all";
}

function cincLabel(header: string): string {
  const stripped = header
    .replace(/today|week to date|year to date|wtd|ytd|mtd/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
  if (/connect/.test(stripped)) return "connects";
  if (/appoint|appt/.test(stripped)) return "appts";
  if (/call/.test(stripped)) return "calls";
  return stripped || "count";
}

function numeric(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Group the CINC tab by agent and sum whatever count columns it has. */
export function cincGroupsFromTable(rows: string[][]): CincGroup[] {
  if (!rows.length) return [];
  const headerAt = rows.slice(0, 8).findIndex((row) =>
    row.some((cell) => /agent|^name$/i.test(cell.trim())),
  );
  const headerIndex = headerAt >= 0 ? headerAt : 0;
  const headers = (rows[headerIndex] ?? []).map((cell) => cell.trim());
  const agentColumn = Math.max(
    0,
    headers.findIndex((header) => /agent|^name$/i.test(header)),
  );
  const countColumns = headers
    .map((header, column) => ({ header, column, period: cincPeriod(header) }))
    .filter((column) => column.column !== agentColumn && column.period !== "skip")
    .filter((column) =>
      rows.slice(headerIndex + 1).some((row) => numeric(row[column.column] ?? "") != null),
    );
  const hasPeriod = countColumns.some((column) => column.period !== "all");
  const used = countColumns.filter((column) => (hasPeriod ? column.period !== "all" : true));
  const groups = new Map<string, CincGroup>();

  rows.slice(headerIndex + 1).forEach((row) => {
    const agent = (row[agentColumn] ?? "").trim();
    if (!agent || /^(agent|name)$/i.test(agent)) return;
    const group = groups.get(agent.toLowerCase()) ?? {
      agent,
      today: [],
      week: [],
      year: [],
    };
    used.forEach((column) => {
      const value = numeric(row[column.column] ?? "");
      if (value == null) return;
      const label = cincLabel(column.header);
      const periods: (keyof Pick<CincGroup, "today" | "week" | "year">)[] =
        column.period === "today" || column.period === "week" || column.period === "year"
          ? [column.period]
          : ["today", "week", "year"];
      periods.forEach((period) => {
        const existing = group[period].find((count) => count.label === label);
        if (existing) existing.value += value;
        else group[period].push({ label, value });
      });
    });
    groups.set(agent.toLowerCase(), group);
  });

  return [...groups.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

function mondayOf(day: CalendarDay): CalendarDay {
  const utc = new Date(Date.UTC(day.year, day.month - 1, day.day));
  const weekday = utc.getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  return addCalendarDays(day, -delta);
}

function cincCallLogGroups(rows: string[][], today: CalendarDay): CincGroup[] {
  const headerAt = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    const hasAgent = headers.some((header) => header === "agent" || header === "name" || header === "agent_name");
    const hasDate = headers.some((header) =>
      /^(date|call_date|called_at|timestamp|call_time|when|day)$/.test(header),
    );
    return hasAgent && hasDate;
  });
  if (headerAt < 0) return [];
  const headers = (rows[headerAt] ?? []).map(normHeader);
  const agentHeader =
    headers.find((header) => header === "agent" || header === "agent_name" || header === "name") ?? "";
  const dateHeader =
    headers.find((header) => /^(date|call_date|called_at|timestamp|call_time|when|day)$/.test(header)) ?? "";
  if (!agentHeader || !dateHeader) return [];
  const weekStart = mondayOf(today);
  const yearStart = { year: today.year, month: 1, day: 1 };
  const groups = new Map<string, CincGroup>();
  rows.slice(headerAt + 1).forEach((row) => {
    const record: Record<string, string> = {};
    headers.forEach((key, column) => {
      if (key) record[key] = (row[column] ?? "").trim();
    });
    const agent = record[agentHeader] ?? "";
    const when = calendarDateFromCell(record[dateHeader] ?? "", today.year);
    if (!agent || /^(agent|name)$/i.test(agent) || !when) return;
    if (compareCalendarDays(when, yearStart) < 0 || compareCalendarDays(when, today) > 0) return;
    const group = groups.get(agent.toLowerCase()) ?? { agent, today: [], week: [], year: [] };
    const bump = (period: "today" | "week" | "year") => {
      const existing = group[period].find((count) => count.label === "calls");
      if (existing) existing.value += 1;
      else group[period].push({ label: "calls", value: 1 });
    };
    bump("year");
    if (compareCalendarDays(when, weekStart) >= 0) bump("week");
    if (compareCalendarDays(when, today) === 0) bump("today");
    groups.set(agent.toLowerCase(), group);
  });
  return [...groups.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

export type CincRead = {
  groups: CincGroup[];
  note: string;
  dataRows: number;
};

/** Counts when the tab has them, otherwise one call per row when the tab is a call log. */
export function cincFromTable(rows: string[][], tabTitle: string, today: CalendarDay = calendarToday()): CincRead {
  const title = tabTitle.trim() || "CINC";
  const dataRows = sheetDataRowCount(rows);
  if (!rows.length || dataRows === 0) {
    return { groups: [], note: `No data in ${title}.`, dataRows: 0 };
  }
  const counted = cincGroupsFromTable(rows).filter(
    (group) => group.today.length > 0 || group.week.length > 0 || group.year.length > 0,
  );
  if (counted.length) return { groups: counted, note: "", dataRows };
  const logged = cincCallLogGroups(rows, today);
  if (logged.length) return { groups: logged, note: "", dataRows };
  return {
    groups: [],
    note: `${title} has ${dataRows} rows, but none had an agent and a count.`,
    dataRows,
  };
}

function loadedTab(
  tabs: SheetTab[],
  tabName: string,
  notes: Partial<Record<OpsCardKey, string>>,
  key: OpsCardKey,
): SheetTab | null {
  const tab = findNamedTab(tabs, tabName);
  if (!tab) return null;
  if (tab.error) {
    notes[key] = tab.error;
    return null;
  }
  return tab;
}

function parseClock(value: string): { hour: number; minute: string } | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const suffix = match[3]?.toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  if (hour > 23 || Number(minute) > 59) return null;
  return { hour, minute };
}

function formatClock(value: string): string {
  const parsed = parseClock(value);
  if (!parsed) return value.trim();
  const suffix = parsed.hour >= 12 ? "PM" : "AM";
  const hour = parsed.hour % 12 || 12;
  return parsed.minute === "00" ? `${hour} ${suffix}` : `${hour}:${parsed.minute} ${suffix}`;
}

function clockMinutes(value: string): number {
  const parsed = parseClock(value);
  if (!parsed) return 24 * 60;
  return parsed.hour * 60 + Number(parsed.minute);
}

/** Upcoming scheduled open houses, soonest first. Past dates are left out. */
export function scheduledOpenHouseRows(
  rows: string[][],
  today: CalendarDay,
  tabTitle: string,
): { items: OpsCardItem[]; columns: Record<string, number> | null } {
  if (!rows.length) return { items: [], columns: null };
  const headerAt = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    const hasAddress = headers.some((header) => ADDRESS_HEADERS.includes(header));
    const hasWhen = headers.some((header) => /^(date|open_house_date|start_time|start|host_agent|host)$/.test(header));
    return hasAddress || hasWhen;
  });
  if (headerAt < 0) return { items: [], columns: null };
  const headers = (rows[headerAt] ?? []).map(normHeader);
  const columns: Record<string, number> = {};
  headers.forEach((key, column) => {
    if (key && columns[key] == null) columns[key] = column;
  });
  const items = rows
    .slice(headerAt + 1)
    .map((row, offset) => {
      const record: Record<string, string> = {};
      headers.forEach((key, column) => {
        if (key) record[key] = (row[column] ?? "").trim();
      });
      return { rowNumber: headerAt + 2 + offset, record };
    })
    .filter((entry) => Object.values(entry.record).some(Boolean))
    .map((entry) => ({
      rowNumber: entry.rowNumber,
      address: field(entry.record, ...ADDRESS_HEADERS),
      host: field(entry.record, "host_agent", "host", "hosting_agent", "agent"),
      notes: field(entry.record, "notes", "note"),
      status: field(entry.record, "status"),
      start: field(entry.record, "start_time", "start"),
      end: field(entry.record, "end_time", "end"),
      date: calendarDateFromCell(field(entry.record, "date", "open_house_date"), today.year),
    }))
    .filter((row) => !closedStatus(row.status) && !/^deleted$/i.test(row.status))
    .filter((row) => !row.date || compareCalendarDays(row.date, today) >= 0)
    .filter((row) => row.address || row.host || row.date)
    .sort((a, b) => {
      if (a.date && b.date) {
        const byDay = compareCalendarDays(a.date, b.date);
        if (byDay !== 0) return byDay;
        return clockMinutes(a.start) - clockMinutes(b.start);
      }
      if (a.date) return -1;
      if (b.date) return 1;
      return a.rowNumber - b.rowNumber;
    })
    .map((row) => {
      const start = formatClock(row.start);
      const end = formatClock(row.end);
      const time = start && end ? `${start}–${end}` : start || end;
      const place = row.address.trim();
      const text = [row.date ? formatLongDate(row.date) : "", time, place, row.host].filter(Boolean).join(" · ");
      const detail = [row.address, time, row.host ? `Host ${row.host}` : "", row.notes].filter(Boolean).join(" · ");
      return item(`open-house-${row.rowNumber}`, text || "Open house", {
        detail: detail || text,
        sheet:
          columns.status == null
            ? undefined
            : cellRef("ops", tabTitle, row.rowNumber, columns.status),
      });
    });
  return { items, columns: Object.keys(columns).length ? columns : null };
}

/** Soonest dated line first. Lines with no date stay at the end. */
export function sortScheduledOpenHouseItems(items: OpsCardItem[]): OpsCardItem[] {
  const today = calendarToday();
  const rank = (item: OpsCardItem) => {
    const [when, time] = item.text.split(" · ");
    const day = calendarDateFromCell(when ?? "", today.year);
    const dayNum = day ? day.year * 10000 + day.month * 100 + day.day : 99_999_999;
    return dayNum * 10_000 + clockMinutes(time ?? "");
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || a.text.localeCompare(b.text));
}

function headerRecordRows(rows: string[][], headerAt: number): { rowNumber: number; record: Record<string, string>; raw: string[] }[] {
  const headers = (rows[headerAt] ?? []).map(normHeader);
  return rows.slice(headerAt + 1).map((raw, offset) => {
    const record: Record<string, string> = {};
    headers.forEach((key, column) => {
      if (key) record[key] = (raw[column] ?? "").trim();
    });
    return { rowNumber: headerAt + 2 + offset, record, raw };
  });
}

/** Sheet rows for the leftover DocuSign test draft, so the dashboard can delete them. */
export function removableDocusignRows(rows: string[][]): number[] {
  if (!rows.length) return [];
  const headerAt = headerIndex(rows, ["address", "status"]);
  const headers = (rows[headerAt] ?? []).map(normHeader);
  if (!headers.includes("address")) return [];
  return headerRecordRows(rows, headerAt)
    .filter((entry) => isForestHillsTest(entry.record, entry.raw))
    .map((entry) => entry.rowNumber);
}

/**
 * OpenHouses rows left behind by a status write: fully blank except a leftover
 * cell, or status deleted. Cancelled rows stay.
 */
export function removableOpenHouseRows(rows: string[][]): number[] {
  if (!rows.length) return [];
  const headerAt = rows.slice(0, 8).findIndex((row) => {
    const headers = row.map(normHeader);
    return headers.some((header) => ADDRESS_HEADERS.includes(header) || header === "date" || header === "status");
  });
  if (headerAt < 0) return [];
  return headerRecordRows(rows, headerAt)
    .filter((entry) => entry.raw.some((cell) => cell.trim()))
    .filter((entry) => {
      const status = field(entry.record, "status");
      if (/^deleted$/i.test(status)) return true;
      const meaningful = [
        field(entry.record, ...ADDRESS_HEADERS),
        field(entry.record, "date", "open_house_date"),
        field(entry.record, "start_time", "start"),
        field(entry.record, "end_time", "end"),
        field(entry.record, "host_agent", "host", "hosting_agent", "agent"),
        field(entry.record, "notes", "note"),
      ].some(Boolean);
      return !meaningful;
    })
    .map((entry) => entry.rowNumber);
}

function unparsedAnnualNote(title: string, rows: string[][], parsed: number): string | null {
  if (parsed > 0) return null;
  const dataRows = sheetDataRowCount(rows);
  if (dataRows === 0) return null;
  return `${title} has ${dataRows} rows, but none had a name and a date.`;
}

export function opsCardsFromTabs(
  tabs: SheetTab[],
  options?: { sheetError?: string | null; today?: CalendarDay },
): {
  cards: OpsCards;
  notes: Partial<Record<OpsCardKey, string>>;
  sheetEmailDrafts: OpsCardItem[];
  todoColumns: Record<string, number> | null;
  openHouseColumns: Record<string, number> | null;
  importantDates: { label: string; notes: string[] }[];
} {
  const notes: Partial<Record<OpsCardKey, string>> = {};
  const cards = emptyOpsCards();
  if (options?.sheetError && tabs.length === 0) {
    (Object.keys(cards) as OpsCardKey[]).forEach((key) => {
      notes[key] = options.sheetError ?? "";
    });
    return { cards, notes, sheetEmailDrafts: [], todoColumns: null, openHouseColumns: null, importantDates: [] };
  }
  if (tabs.length === 0) {
    return { cards, notes, sheetEmailDrafts: [], todoColumns: null, openHouseColumns: null, importantDates: [] };
  }

  const today = options?.today ?? calendarToday();
  const anniversaries = loadedTab(tabs, OPS_CARD_TABS.clientAnniversaries.tab, notes, "clientAnniversaries");
  const birthdays = loadedTab(tabs, OPS_CARD_TABS.clientBirthdays.tab, notes, "clientBirthdays");
  const referrals = loadedTab(tabs, OPS_CARD_TABS.referralExchange.tab, notes, "referralExchange");
  const emails = loadedTab(tabs, OPS_CARD_TABS.outstandingEmails.tab, notes, "outstandingEmails");
  const drafts = loadedTab(tabs, OPS_CARD_TABS.docusignDrafts.tab, notes, "docusignDrafts");
  const keyDates = loadedTab(tabs, OPS_CARD_TABS.completionDates.tab, notes, "completionDates");
  const subjectRemovals = loadedTab(tabs, OPS_CARD_TABS.subjectRemovals.tab, notes, "subjectRemovals");
  const todos = loadedTab(tabs, OPS_CARD_TABS.todos.tab, notes, "todos");
  const openHouses = loadedTab(tabs, OPS_CARD_TABS.scheduledOpenHouses.tab, notes, "scheduledOpenHouses");
  const emailDrafts = findNamedTab(tabs, EMAIL_DRAFTS_TAB);
  const googleBusinessQueue = findNamedTab(tabs, GOOGLE_BUSINESS_QUEUE_TAB);
  const googleBusiness = findNamedTab(tabs, GOOGLE_BUSINESS_TAB);
  const gbp = findNamedTab(tabs, GBP_TAB);
  const closedDeals = keyDates ? closedDealAddressKeys(keyDates.rows, today) : null;

  if (anniversaries) {
    cards.clientAnniversaries = annualRows(anniversaries.rows, today, 10, "anniversary");
    const unparsed = unparsedAnnualNote(anniversaries.title, anniversaries.rows, cards.clientAnniversaries.length);
    if (unparsed) notes.clientAnniversaries = unparsed;
  }
  if (birthdays) {
    cards.clientBirthdays = annualRows(birthdays.rows, today, 10, "birthday");
    const unparsed = unparsedAnnualNote(birthdays.title, birthdays.rows, cards.clientBirthdays.length);
    if (unparsed) notes.clientBirthdays = unparsed;
  }
  if (referrals) cards.referralExchange = referralRows(referrals.rows, today);
  if (emails) cards.outstandingEmails = emailRows(emails.rows, today, emails.title);
  if (drafts) cards.docusignDrafts = draftRows(drafts.rows, today, drafts.title);
  const importantDates = keyDates ? importantDatesFromKeySheet(keyDates.rows, today) : [];
  if (keyDates) {
    cards.completionDates = dealItems(
      dealsFromDateSheet(keyDates.rows, today, "completion", keyDates.title),
      "completion",
    );
  }
  if (subjectRemovals) {
    const parsed = subjectRemovalRows(subjectRemovals.rows, today);
    cards.subjectRemovals = parsed.items;
    if (parsed.items.length === 0) {
      const dataRows = sheetDataRowCount(subjectRemovals.rows);
      notes.subjectRemovals = !dataRows
        ? `No data in ${subjectRemovals.title}.`
        : parsed.recognized
          ? `${subjectRemovals.title} has ${dataRows} rows, but none are still upcoming.`
          : `${subjectRemovals.title} has ${dataRows} rows, but none had an address and a subject_removal_date.`;
    }
  } else if (!notes.subjectRemovals) {
    notes.subjectRemovals = `No data in ${OPS_CARD_TABS.subjectRemovals.tab}.`;
  }
  if (todos) cards.todos = todoRows(todos.rows, today, todos.title, closedDeals);
  let openHouseColumns: Record<string, number> | null = null;
  if (openHouses) {
    const scheduled = scheduledOpenHouseRows(openHouses.rows, today, openHouses.title);
    cards.scheduledOpenHouses = scheduled.items;
    openHouseColumns = scheduled.columns;
    if (scheduled.items.length === 0 && sheetDataRowCount(openHouses.rows) > 0) {
      notes.scheduledOpenHouses = `${openHouses.title} has ${sheetDataRowCount(openHouses.rows)} rows, but none are upcoming open houses.`;
    }
  }
  const queueTitles = new Set<string>();
  const queued =
    googleBusinessQueue && !googleBusinessQueue.error && googleBusinessQueueHeader(googleBusinessQueue.rows) >= 0
      ? googleBusinessQueueRows(googleBusinessQueue.rows, today, googleBusinessQueue.title)
      : [];
  if (queued.length || (googleBusinessQueue && googleBusinessQueueHeader(googleBusinessQueue.rows) >= 0)) {
    queueTitles.add(googleBusinessQueue?.title.toLowerCase() ?? "");
  }
  const looseTabs = [googleBusinessQueue, googleBusiness, gbp].filter((tab): tab is SheetTab =>
    Boolean(tab && !tab.error && !queueTitles.has(tab.title.toLowerCase())),
  );
  const seenLoose = new Set<string>();
  const gbpRows = [
    ...queued,
    ...looseTabs.flatMap((tab) => {
      const key = tab.title.toLowerCase();
      if (seenLoose.has(key)) return [];
      seenLoose.add(key);
      if (googleBusinessQueueHeader(tab.rows) >= 0) {
        return googleBusinessQueueRows(tab.rows, today, tab.title);
      }
      return googleBusinessRows(tab.rows, tab.title);
    }),
  ];
  cards.googleBusiness = gbpRows;
  const sheetEmailDrafts =
    emailDrafts && !emailDrafts.error ? emailDraftSheetRows(emailDrafts.rows, today, emailDrafts.title) : [];
  return {
    cards,
    notes,
    sheetEmailDrafts,
    todoColumns: todos ? todoHeaderColumns(todos.rows) : null,
    openHouseColumns,
    importantDates,
  };
}

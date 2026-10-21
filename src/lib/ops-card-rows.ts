import {
  emptyOpsCards,
  type OpsCardItem,
  type OpsCardKey,
  type OpsCards,
} from "@/lib/dashboard-data";
import {
  addCalendarDays,
  calendarToday,
  compareCalendarDays,
  firstCalendarDate,
  formatLongDate,
  formatWeekday,
  nextAnnualDate,
  type CalendarDay,
} from "@/lib/dashboard-text";
import type { SheetTab } from "@/lib/google-sheets";

/**
 * AREG Ops tab names and columns. KeyDates feeds two cards.
 * Firm-transaction checklist rows come from TRANSACTIONS_SHEET_ID.
 */
export const OPS_CARD_TABS: Record<
  OpsCardKey,
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
    tab: "KeyDates",
    columns: ["address", "side", "agent", "subject_removal_date", "completion_date", "possession_date", "source"],
  },
  completionDates: {
    tab: "KeyDates",
    columns: ["address", "side", "agent", "subject_removal_date", "completion_date", "possession_date", "source"],
  },
  todos: {
    tab: "ToDos",
    columns: ["due_date", "item", "address", "owner_bot", "status"],
  },
};

export const FIRM_TODO_TAB = "Firm Transactions To Dos";

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
  if (!rows.length) return [];
  const index = headerIndex(rows, markers);
  const headers = (rows[index] ?? []).map(normHeader);
  return rows.slice(index + 1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((key, column) => {
      if (!key) return;
      record[key] = (row[column] ?? "").trim();
    });
    return record;
  }).filter((record) => Object.values(record).some(Boolean));
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

function item(id: string, text: string, section?: OpsCardItem["section"]): OpsCardItem {
  return section ? { id, text, section } : { id, text };
}

function annualRows(
  rows: string[][],
  today: CalendarDay,
  limit: number,
  prefix: string,
): OpsCardItem[] {
  const dated = recordsFrom(rows, ["name", "date"])
    .map((record) => {
      const name = field(record, "name");
      const parsed = firstCalendarDate(field(record, "date", "move_in_date"), today.year);
      const upcoming = parsed ? nextAnnualDate(parsed.month, parsed.day, today) : null;
      return { name, note: field(record, "note", "notes"), upcoming };
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
  return recordsFrom(rows, ["agent", "week_start"])
    .map((record) => ({
      agent: field(record, "agent"),
      phone: field(record, "phone"),
      note: field(record, "note", "notes"),
      week: firstCalendarDate(field(record, "week_start"), today.year),
      setOn: firstCalendarDate(field(record, "set_on"), today.year),
    }))
    .filter((row) => row.agent)
    .sort((a, b) => {
      const week = compareCalendarDays(
        b.week ?? { year: 0, month: 1, day: 1 },
        a.week ?? { year: 0, month: 1, day: 1 },
      );
      if (week !== 0) return week;
      return compareCalendarDays(
        b.setOn ?? { year: 0, month: 1, day: 1 },
        a.setOn ?? { year: 0, month: 1, day: 1 },
      );
    })
    .slice(0, OPS_CARD_TABS.referralExchange.latest ?? 6)
    .map((row, index) => {
      const parts = [row.agent];
      if (row.phone) parts.push(row.phone);
      if (row.week) parts.push(`week of ${formatLongDate(row.week)}`);
      if (row.setOn) parts.push(`set ${formatWeekday(row.setOn)}`);
      if (row.note) parts.push(row.note);
      return item(`referral-${index}`, parts.join(" · "));
    });
}

function emailLabel(type: string): string {
  const value = type.trim().toLowerCase();
  if (value === "firm") return "firm email";
  if (value === "completion") return "completion email";
  if (value === "review") return "review email";
  if (value === "pre-completion" || value === "precompletion") return "pre-completion email";
  return type.trim();
}

function emailRows(rows: string[][], today: CalendarDay): OpsCardItem[] {
  const horizon = addCalendarDays(today, 7);
  const open = recordsFrom(rows, ["address", "due_date"])
    .map((record) => ({
      address: field(record, "address"),
      type: field(record, "email_type"),
      status: field(record, "status"),
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

  const line = (row: (typeof open)[number], section: OpsCardItem["section"], index: number) =>
    item(
      `email-${section}-${index}`,
      `${row.address} · ${emailLabel(row.type) || "email"} · due ${formatLongDate(row.due!)}`,
      section,
    );
  return [
    ...due.map((row, index) => line(row, "due", index)),
    ...upcoming.map((row, index) => line(row, "upcoming", index)),
  ];
}

function draftRows(rows: string[][], today: CalendarDay): OpsCardItem[] {
  return recordsFrom(rows, ["address", "status"])
    .map((record) => ({
      address: field(record, "address"),
      type: field(record, "envelope_type"),
      signers: field(record, "signers"),
      subject: field(record, "envelope_subject"),
      requestedBy: field(record, "requested_by"),
      status: field(record, "status"),
      created: firstCalendarDate(field(record, "created_at"), today.year),
    }))
    .filter((row) => row.address && /^draft$/i.test(row.status.trim()))
    .sort((a, b) =>
      compareCalendarDays(
        b.created ?? { year: 0, month: 1, day: 1 },
        a.created ?? { year: 0, month: 1, day: 1 },
      ),
    )
    .map((row, index) => {
      const parts = [row.address];
      if (row.type) parts.push(row.type);
      if (row.signers) parts.push(row.signers);
      if (row.subject) parts.push(row.subject);
      if (row.requestedBy) parts.push(`requested by ${row.requestedBy}`);
      return item(`draft-${index}`, parts.join(" · "));
    });
}

function keyDateRows(
  rows: string[][],
  today: CalendarDay,
  dateColumn: "subject_removal_date" | "completion_date",
  prefix: string,
): OpsCardItem[] {
  return recordsFrom(rows, ["address", dateColumn])
    .map((record) => ({
      address: field(record, "address"),
      side: field(record, "side"),
      agent: field(record, "agent"),
      source: field(record, "source"),
      date: firstCalendarDate(field(record, dateColumn), today.year),
      possession: firstCalendarDate(field(record, "possession_date"), today.year),
    }))
    .filter(
      (row): row is typeof row & { date: CalendarDay } =>
        Boolean(row.address && row.date && compareCalendarDays(row.date, today) >= 0),
    )
    .sort((a, b) => compareCalendarDays(a.date, b.date))
    .map((row, index) => {
      const parts = [row.address];
      if (row.side) parts.push(row.side);
      if (row.agent) parts.push(row.agent);
      parts.push(formatLongDate(row.date));
      if (dateColumn === "completion_date" && row.possession) {
        parts.push(`possession ${formatLongDate(row.possession)}`);
      }
      if (row.source) parts.push(row.source);
      return item(`${prefix}-${index}`, parts.join(" · "));
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

function todoRows(rows: string[][], today: CalendarDay): OpsCardItem[] {
  return recordsFrom(rows, ["item"])
    .map((record) => ({
      task: field(record, "item"),
      address: field(record, "address"),
      status: field(record, "status"),
      due: firstCalendarDate(field(record, "due_date"), today.year),
    }))
    .filter((row) => row.task && !closedStatus(row.status))
    .sort((a, b) => {
      if (a.due && b.due) return compareCalendarDays(a.due, b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    })
    .map((row, index) =>
      item(`todo-${index}`, todoSentenceFromSheet(row.task, row.address, row.due)),
    )
    .filter((row) => row.text);
}

export function transactionChecklistItems(rows: string[][]): OpsCardItem[] {
  const body = recordsFrom(rows, ["transactions", "client_name"]);
  const items: OpsCardItem[] = [];
  body.forEach((record, rowIndex) => {
    const property = field(record, "transactions", "transaction");
    const client = field(record, "client_name");
    const who =
      property && client && property.toLowerCase() !== client.toLowerCase()
        ? `${property} (${client})`
        : property || client;
    if (!who) return;
    FIRM_CHECKS.forEach((check) => {
      if ((record[check.column] ?? "").trim()) return;
      items.push(item(`firm-${rowIndex}-${check.column}`, check.sentence(who)));
    });
  });
  return items;
}

function tabRows(
  tabs: SheetTab[],
  tabName: string,
  notes: Partial<Record<OpsCardKey, string>>,
  key: OpsCardKey,
): string[][] | null {
  const tab = findNamedTab(tabs, tabName);
  if (!tab) return null;
  if (tab.error) {
    notes[key] = tab.error;
    return null;
  }
  return tab.rows;
}

export function opsCardsFromTabs(
  tabs: SheetTab[],
  options?: { sheetError?: string | null; today?: CalendarDay },
): { cards: OpsCards; notes: Partial<Record<OpsCardKey, string>> } {
  const notes: Partial<Record<OpsCardKey, string>> = {};
  const cards = emptyOpsCards();
  if (options?.sheetError && tabs.length === 0) {
    (Object.keys(cards) as OpsCardKey[]).forEach((key) => {
      notes[key] = options.sheetError ?? "";
    });
    return { cards, notes };
  }
  if (tabs.length === 0) return { cards, notes };

  const today = options?.today ?? calendarToday();
  const anniversaries = tabRows(tabs, OPS_CARD_TABS.clientAnniversaries.tab, notes, "clientAnniversaries");
  const birthdays = tabRows(tabs, OPS_CARD_TABS.clientBirthdays.tab, notes, "clientBirthdays");
  const referrals = tabRows(tabs, OPS_CARD_TABS.referralExchange.tab, notes, "referralExchange");
  const emails = tabRows(tabs, OPS_CARD_TABS.outstandingEmails.tab, notes, "outstandingEmails");
  const drafts = tabRows(tabs, OPS_CARD_TABS.docusignDrafts.tab, notes, "docusignDrafts");
  const keyDates = tabRows(tabs, OPS_CARD_TABS.subjectRemovals.tab, notes, "subjectRemovals");
  if (!keyDates && !notes.completionDates) {
    notes.completionDates = notes.subjectRemovals;
  }
  const todos = tabRows(tabs, OPS_CARD_TABS.todos.tab, notes, "todos");

  if (anniversaries) {
    cards.clientAnniversaries = annualRows(anniversaries, today, 10, "anniversary");
  }
  if (birthdays) cards.clientBirthdays = annualRows(birthdays, today, 10, "birthday");
  if (referrals) cards.referralExchange = referralRows(referrals, today);
  if (emails) cards.outstandingEmails = emailRows(emails, today);
  if (drafts) cards.docusignDrafts = draftRows(drafts, today);
  if (keyDates) {
    cards.subjectRemovals = keyDateRows(keyDates, today, "subject_removal_date", "subject");
    cards.completionDates = keyDateRows(keyDates, today, "completion_date", "completion");
    delete notes.completionDates;
  }
  if (todos) cards.todos = todoRows(todos, today);
  return { cards, notes };
}

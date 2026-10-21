import type { OpenHouseRow } from "@/lib/dashboard-data";

export type CalendarDay = { year: number; month: number; day: number };

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_PATTERN =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

export function calendarToday(
  now = new Date(),
  timeZone = "America/Vancouver",
): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function formatLongDate(day: CalendarDay): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

function dayNumber(day: CalendarDay): number {
  return day.year * 10000 + day.month * 100 + day.day;
}

function shiftDay(day: CalendarDay, days: number): CalendarDay {
  const utc = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function isSaturday(day: CalendarDay): boolean {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() === 6;
}

function isRealDay(day: CalendarDay): boolean {
  if (day.month < 1 || day.month > 12 || day.day < 1 || day.day > 31) return false;
  const utc = new Date(Date.UTC(day.year, day.month - 1, day.day));
  return (
    utc.getUTCFullYear() === day.year &&
    utc.getUTCMonth() === day.month - 1 &&
    utc.getUTCDate() === day.day
  );
}

function monthNumber(name: string): number {
  return MONTHS[name.toLowerCase().slice(0, 4)] ?? MONTHS[name.toLowerCase().slice(0, 3)] ?? 0;
}

function withYear(month: number, day: number, year: string | undefined, fallbackYear: number): CalendarDay | null {
  const parsedYear = year
    ? Number(year.length === 2 ? `20${year}` : year)
    : fallbackYear;
  const next = { year: parsedYear, month, day };
  return isRealDay(next) ? next : null;
}

/** Every calendar date mentioned in a freeform line. */
export function parseCalendarDates(text: string, fallbackYear: number): CalendarDay[] {
  const found: CalendarDay[] = [];
  const taken: boolean[] = Array.from({ length: text.length }, () => false);

  function occupied(start: number, end: number): boolean {
    return taken.slice(start, end).some(Boolean);
  }

  function occupy(start: number, end: number) {
    for (let i = start; i < end; i++) taken[i] = true;
  }

  function keep(day: CalendarDay | null) {
    if (day) found.push(day);
  }

  const iso = new RegExp("\\b(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b", "g");
  for (const match of text.matchAll(iso)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (occupied(start, end)) continue;
    keep(withYear(Number(match[2]), Number(match[3]), match[1], fallbackYear));
    occupy(start, end);
  }

  const named = new RegExp(
    `\\b(?:(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:\\s*[-–]\\s*(\\d{1,2}))?(?:,?\\s*(\\d{4}))?|(\\d{1,2})(?:\\s*[-–]\\s*(\\d{1,2}))?\\s+(${MONTH_PATTERN})\\.?(?:,?\\s*(\\d{4}))?)`,
    "gi",
  );
  for (const match of text.matchAll(named)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (occupied(start, end)) continue;
    if (match[1]) {
      const month = monthNumber(match[1]);
      keep(withYear(month, Number(match[2]), match[4], fallbackYear));
      if (match[3]) keep(withYear(month, Number(match[3]), match[4], fallbackYear));
    } else if (match[7]) {
      const month = monthNumber(match[7]);
      keep(withYear(month, Number(match[5]), match[8], fallbackYear));
      if (match[6]) keep(withYear(month, Number(match[6]), match[8], fallbackYear));
    }
    occupy(start, end);
  }

  const numeric = /\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/g;
  for (const match of text.matchAll(numeric)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    let month = first;
    let day = second;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    }
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (occupied(start, end)) continue;
    keep(withYear(month, day, match[3], fallbackYear));
    occupy(start, end);
  }

  return found;
}

function latestDay(days: CalendarDay[]): CalendarDay | null {
  if (!days.length) return null;
  return days.reduce((latest, day) => (dayNumber(day) > dayNumber(latest) ? day : latest));
}

/** Sunday of a Saturday date, otherwise the date itself. */
export function weekendEnd(days: CalendarDay[]): CalendarDay | null {
  const latest = latestDay(days);
  if (!latest) return null;
  return isSaturday(latest) ? shiftDay(latest, 1) : latest;
}

export function isPastWeekend(windowLabel: string, today = calendarToday()): boolean {
  const end = weekendEnd(parseCalendarDates(windowLabel, today.year));
  if (!end) return false;
  return dayNumber(end) < dayNumber(today);
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function emptyish(value: string): boolean {
  return value === "" || /^(n\/a|na|none|—|-)$/i.test(value);
}

function deletedMarker(value: string): boolean {
  return /^(deleted|delete|removed|cancelled|canceled)$/i.test(value);
}

export function isBlankOpenHouse(row: OpenHouseRow): boolean {
  return [row.agent, row.window, row.saturday, row.sunday, row.notes].every((value) =>
    emptyish(clean(value)),
  );
}

export function isDeletedOpenHouse(row: OpenHouseRow): boolean {
  return [row.agent, row.window, row.saturday, row.sunday, row.notes].some((value) =>
    deletedMarker(clean(value)),
  );
}

/** Keep responses that are filled in, not marked deleted, and not from a past weekend. */
export function currentOpenHouseRows(
  rows: OpenHouseRow[],
  today = calendarToday(),
): OpenHouseRow[] {
  return rows.filter(
    (row) =>
      !isBlankOpenHouse(row) &&
      !isDeletedOpenHouse(row) &&
      !isPastWeekend(row.window, today),
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function finishSentence(value: string): string {
  const text = capitalize(value.trim());
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function sentenceFromFields(fields: string[]): string {
  const [action, ...rest] = fields;
  if (rest.length === 1) {
    if (/^(follow up|meet|talk|check in)$/i.test(action)) {
      return `${action} with ${rest[0]}`;
    }
    return `${action} ${rest[0]}`;
  }
  if (
    rest.length >= 2 &&
    /^(follow up|call|email|text|message|book|print|send|review|confirm|schedule|ask|meet)$/i.test(
      action,
    )
  ) {
    const person = /^(follow up|meet|talk|check in)$/i.test(action)
      ? `with ${rest[0]}`
      : rest[0];
    return `${action} ${person} about ${rest.slice(1).join(", ")}`;
  }
  return fields.join(" ");
}

/** One to-do line, written as a sentence rather than separate fields. */
export function todoSentence(raw: string): string {
  let line = raw.replace(/^[-*•]+\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
  line = line.replace(/^(todo|to-?do|task)\b[:\-\s]*/i, "").trim();
  if (!line) return "";
  const fields = line
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return finishSentence(fields.length > 1 ? sentenceFromFields(fields) : line);
}

function stripParsedDate(line: string, years: number[]): string {
  let note = line
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(
      new RegExp(
        `\\b(?:(?:${MONTH_PATTERN})\\.?\\s+\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?(?:,?\\s*\\d{4})?|\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?\\s+(?:${MONTH_PATTERN})\\.?(?:,?\\s*\\d{4})?)`,
        "gi",
      ),
      " ",
    )
    .replace(/\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\b/g, " ")
    .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b,?/gi, " ");
  for (const year of years) {
    note = note.replace(new RegExp(`\\b${year}\\b`, "g"), " ");
  }
  return note
    .replace(/\s+/g, " ")
    .replace(/^[\s,:—\-–]+|[\s,:—\-–]+$/g, "")
    .replace(/\s*[—–-]\s*/g, " ")
    .trim();
}

/** "Oct 21 listing expires" → "Wednesday, October 21, 2026 — Listing expires". */
export function importantDateLine(raw: string, today = calendarToday()): string {
  const line = raw.replace(/^[-*•]+\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
  if (!line) return "";
  const dates = parseCalendarDates(line, today.year);
  const day = latestDay(dates);
  if (!day) return capitalize(line);
  const note = stripParsedDate(line, dates.map((item) => item.year));
  const formatted = formatLongDate(day);
  return note ? `${formatted} — ${capitalize(note)}` : formatted;
}

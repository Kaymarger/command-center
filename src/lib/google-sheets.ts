import { createSign } from "node:crypto";
import type { OpenHouseRow } from "@/lib/dashboard-data";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

type TokenCache = { token: string; expiresAt: number };

const tokenGlobal = globalThis as typeof globalThis & {
  __areg_google_token__?: TokenCache;
};

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function opsSheetId(): string {
  return envValue("AREG_OPS_SHEET_ID");
}

export function openHouseSheetId(): string {
  return envValue("OPEN_HOUSE_SHEET_ID");
}

export function transactionsSheetId(): string {
  return envValue("TRANSACTIONS_SHEET_ID");
}

export function loadServiceAccount(): ServiceAccount | null {
  const raw = envValue("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is set, but it is not valid JSON. Paste the whole key file, including the curly braces.",
    );
  }
  const email = parsed.client_email?.trim() ?? "";
  let key = parsed.private_key?.trim() ?? "";
  if (!email || !key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key. Use the JSON key downloaded from Google Cloud.",
    );
  }
  key = key.replace(/\\n/g, "\n");
  return { client_email: email, private_key: key };
}

export function serviceAccountEmail(): string | null {
  try {
    return loadServiceAccount()?.client_email ?? null;
  } catch {
    return null;
  }
}

function base64url(value: string | Buffer): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
}

async function accessToken(): Promise<{ token: string; email: string }> {
  const account = loadServiceAccount();
  if (!account) {
    throw new Error("No Google service account is configured.");
  }
  const cached = tokenGlobal.__areg_google_token__;
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { token: cached.token, email: account.client_email };
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new Error(
      `Google did not accept the service account key (${detail}). Check GOOGLE_SERVICE_ACCOUNT_JSON.`,
    );
  }
  tokenGlobal.__areg_google_token__ = {
    token: body.access_token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };
  return { token: body.access_token, email: account.client_email };
}

export type SheetTab = {
  title: string;
  sheetId: number;
  rows: string[][];
  error?: string;
  /** A1 range Google says it returned, such as 'Form Responses 1'!A1:F5. */
  reportedRange?: string;
  /** False when the JSON had no `values` array. */
  valuesKeyPresent?: boolean;
};

export const FORM_RESPONSES_TAB = "Form Responses 1";

/** How long a successful values.batchGet can be reused. */
export const SHEET_VALUE_CACHE_MS = 60_000;

/** How long we remember which tabs exist, so a missing tab is not requested again. */
const SHEET_PLAN_TTL_MS = 10 * 60_000;

export class GoogleReadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleReadError";
    this.status = status;
  }
}

export function isQuotaError(error: unknown): boolean {
  if (error instanceof GoogleReadError && error.status === 429) return true;
  const message = error instanceof Error ? error.message : "";
  return /quota exceeded|read requests per minute per user/i.test(message);
}

export function isMissingRangeError(error: unknown): boolean {
  if (!(error instanceof GoogleReadError) || error.status !== 400) return false;
  return /unable to parse range/i.test(error.message);
}

export type WantedTab = { title: string; sheetId?: number };

type ListedTab = { title: string; sheetId: number };
type ValueCacheEntry = { at: number; tabs: SheetTab[] };
type PlanEntry = { at: number; fetch: ListedTab[]; missing: string[] };
type ReadState = {
  reads: number[];
  now: (() => number) | null;
  values: Map<string, ValueCacheEntry>;
  plans: Map<string, PlanEntry>;
  inflight: Map<string, Promise<unknown>>;
};

function readState(): ReadState {
  const g = globalThis as typeof globalThis & { __areg_sheet_reads_state__?: ReadState };
  if (!g.__areg_sheet_reads_state__) {
    g.__areg_sheet_reads_state__ = {
      reads: [],
      now: null,
      values: new Map(),
      plans: new Map(),
      inflight: new Map(),
    };
  }
  return g.__areg_sheet_reads_state__;
}

export function sheetNow(): number {
  return readState().now?.() ?? Date.now();
}

export function setSheetClock(now: (() => number) | null) {
  readState().now = now;
}

export function resetSheetReadState() {
  const state = readState();
  state.reads = [];
  state.values.clear();
  state.plans.clear();
  state.inflight.clear();
}

export function sheetReadsSince(startMs: number): number {
  return readState().reads.filter((at) => at >= startMs).length;
}

function noteSheetRead() {
  const state = readState();
  const now = sheetNow();
  state.reads.push(now);
  const cutoff = now - 10 * 60_000;
  if (state.reads.length > 40) {
    state.reads = state.reads.filter((at) => at >= cutoff);
  }
}

function shareInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const state = readState();
  const existing = state.inflight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = run().finally(() => {
    if (state.inflight.get(key) === pending) state.inflight.delete(key);
  });
  state.inflight.set(key, pending);
  return pending;
}

function quotedRange(title: string): string {
  const escaped = title.replace(/'/g, "''");
  return `'${escaped}'!A:Z`;
}

function sameTitle(left: string, right: string): boolean {
  if (left.trim().toLowerCase() === right.trim().toLowerCase()) return true;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(left);
  const b = norm(right);
  return a.length > 0 && a === b;
}

function googleError(status: number, body: unknown, label: string, email?: string): GoogleReadError {
  const detail =
    (body as { error?: { message?: string } } | null)?.error?.message?.trim() ?? "";
  let message = detail
    ? `Google could not read ${label} (HTTP ${status}): ${detail}`
    : `Google could not read ${label} (HTTP ${status}).`;
  if (status === 403 && email) {
    message += ` Share the sheet with ${email} as a Viewer or Editor.`;
  }
  if (status === 404) {
    message += " Check the spreadsheet id on the host.";
  }
  return new GoogleReadError(status, message);
}

async function googleJson(
  url: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  return shareInflight(`GET ${url}`, async () => {
    noteSheetRead();
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as unknown;
    return { status: res.status, body };
  });
}

function cellsFrom(values: unknown): string[][] {
  if (!Array.isArray(values)) return [];
  return values.map((row) =>
    Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : [],
  );
}

function titleFromRange(range: string | undefined, fallback: string): string {
  if (!range) return fallback;
  const quoted = range.match(/^'((?:''|[^'])*)'!/);
  if (quoted) return quoted[1].replace(/''/g, "'");
  const plain = range.match(/^([^!]+)!/);
  return plain?.[1] ?? fallback;
}

function emptyTab(title: string, sheetId = 0): SheetTab {
  return { title, sheetId, rows: [], valuesKeyPresent: true };
}

function dedupeWanted(wanted: WantedTab[]): WantedTab[] {
  const out: WantedTab[] = [];
  for (const item of wanted) {
    const title = item.title.trim();
    if (!title) continue;
    const existing = out.find((row) => sameTitle(row.title, title));
    if (existing) {
      if (existing.sheetId == null && item.sheetId != null) existing.sheetId = item.sheetId;
      continue;
    }
    out.push({ title, sheetId: item.sheetId });
  }
  return out;
}

async function batchGetOnce(
  spreadsheetId: string,
  tabs: ListedTab[],
): Promise<SheetTab[]> {
  if (!tabs.length) return [];
  const { token, email } = await accessToken();
  const params = new URLSearchParams();
  params.set("valueRenderOption", "FORMATTED_VALUE");
  params.set("majorDimension", "ROWS");
  for (const tab of tabs) params.append("ranges", quotedRange(tab.title));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`;
  const { status, body } = await googleJson(url, token);
  if (status !== 200) {
    throw googleError(status, body, "the spreadsheet", email);
  }
  const valueRanges =
    (body as { valueRanges?: { range?: string; values?: unknown }[] }).valueRanges ?? [];
  return tabs.map((tab, index) => {
    const entry = valueRanges[index];
    const values = entry?.values;
    return {
      title: titleFromRange(entry?.range, tab.title),
      sheetId: tab.sheetId,
      reportedRange: typeof entry?.range === "string" ? entry.range : undefined,
      valuesKeyPresent: Array.isArray(values),
      rows: cellsFrom(values),
    };
  });
}

async function batchGetCached(spreadsheetId: string, tabs: ListedTab[]): Promise<SheetTab[]> {
  if (!tabs.length) return [];
  const key = `${spreadsheetId}\n${tabs.map((tab) => tab.title).join("\n")}`;
  const state = readState();
  const hit = state.values.get(key);
  if (hit && sheetNow() - hit.at < SHEET_VALUE_CACHE_MS) return hit.tabs;
  return shareInflight(`values:${key}`, async () => {
    const again = state.values.get(key);
    if (again && sheetNow() - again.at < SHEET_VALUE_CACHE_MS) return again.tabs;
    const loaded = await batchGetOnce(spreadsheetId, tabs);
    state.values.set(key, { at: sheetNow(), tabs: loaded });
    return loaded;
  });
}

async function listSheetProperties(spreadsheetId: string): Promise<ListedTab[]> {
  return shareInflight(`meta:${spreadsheetId}`, async () => {
    const { token, email } = await accessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title,sheetId)`;
    const { status, body } = await googleJson(url, token);
    if (status !== 200) throw googleError(status, body, "the spreadsheet", email);
    const sheets =
      (body as { sheets?: { properties?: { title?: string; sheetId?: number } }[] }).sheets ??
      [];
    return sheets.map((sheet) => ({
      title: sheet.properties?.title?.trim() || "Sheet",
      sheetId: sheet.properties?.sheetId ?? 0,
    }));
  });
}

function matchListed(want: WantedTab, listed: ListedTab[]): ListedTab | undefined {
  if (want.sheetId != null) {
    const byId = listed.find((tab) => tab.sheetId === want.sheetId);
    if (byId) return byId;
  }
  return listed.find((tab) => sameTitle(tab.title, want.title));
}

/**
 * Read every requested tab with one spreadsheets.values.batchGet.
 * Tabs that are not in the spreadsheet come back empty. With discoverMissing,
 * a missing name is learned once and then left out of later batch calls.
 */
export async function readNamedTabs(
  spreadsheetId: string,
  wanted: WantedTab[],
  options?: { discoverMissing?: boolean },
): Promise<SheetTab[]> {
  const names = dedupeWanted(wanted);
  const planKey = `${spreadsheetId}|${names.map((tab) => tab.title).join("|")}|${options?.discoverMissing ? "discover" : "exact"}`;
  const state = readState();
  const plan = options?.discoverMissing ? state.plans.get(planKey) : undefined;
  if (plan && sheetNow() - plan.at < SHEET_PLAN_TTL_MS) {
    try {
      const fetched = await batchGetCached(spreadsheetId, plan.fetch);
      return [...fetched, ...plan.missing.map((title) => emptyTab(title))];
    } catch (error) {
      if (isQuotaError(error) || !isMissingRangeError(error)) throw error;
      state.plans.delete(planKey);
    }
  }

  const requested = names.map((tab) => ({ title: tab.title, sheetId: tab.sheetId ?? 0 }));
  try {
    const fetched = await batchGetCached(spreadsheetId, requested);
    if (options?.discoverMissing) {
      state.plans.set(planKey, {
        at: sheetNow(),
        fetch: requested,
        missing: [],
      });
    }
    return fetched;
  } catch (error) {
    if (!options?.discoverMissing && isMissingRangeError(error)) {
      const empty = names.map((tab) => emptyTab(tab.title, tab.sheetId ?? 0));
      state.values.set(
        `${spreadsheetId}\n${names.map((tab) => tab.title).join("\n")}`,
        { at: sheetNow(), tabs: empty },
      );
      return empty;
    }
    if (!options?.discoverMissing || !isMissingRangeError(error)) throw error;
    const listed = await listSheetProperties(spreadsheetId);
    const fetch: ListedTab[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const want of names) {
      const found = matchListed(want, listed);
      if (!found) {
        missing.push(want.title);
        continue;
      }
      const key = found.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fetch.push(found);
    }
    const loaded = await batchGetCached(spreadsheetId, fetch);
    state.plans.set(planKey, { at: sheetNow(), fetch, missing });
    return [...loaded, ...missing.map((title) => emptyTab(title))];
  }
}

export async function readSpreadsheet(spreadsheetId: string): Promise<SheetTab[]> {
  const listed = await listSheetProperties(spreadsheetId);
  return batchGetCached(spreadsheetId, listed);
}

export async function readPublicCsv(spreadsheetId: string, gid: number): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  const text = await res.text();
  if (!res.ok || text.includes("<!DOCTYPE html") || /accounts\.google\.com|Sign in/i.test(text)) {
    const email = serviceAccountEmail();
    throw new Error(
      email
        ? `The sheet is not public, and the service account could not be used. Share the sheet with ${email} as a Viewer.`
        : "The sheet is private, so this site cannot read it. Add GOOGLE_SERVICE_ACCOUNT_JSON on Vercel, then share the sheet with that account’s email as a Viewer.",
    );
  }
  const { parseCsv } = await import("@/lib/feeds-io");
  return parseCsv(text);
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[:?：？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function columnIndex(headers: string[], names: string[]): number {
  const exact = headers.findIndex((header) => names.includes(header));
  if (exact >= 0) return exact;
  return headers.findIndex((header) =>
    names.some((name) => header === name || header.startsWith(`${name} `)),
  );
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}

function timeValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Prefer the Google Form tab, including the default name "Form Responses 1". */
export function formResponsesTab(tabs: SheetTab[]): SheetTab | undefined {
  const exact = tabs.find(
    (tab) => tab.title.trim().toLowerCase() === "form responses 1",
  );
  if (exact) return exact;
  return (
    tabs.find((tab) => /form responses/i.test(tab.title)) ??
    tabs.find((tab) => /response/i.test(tab.title)) ??
    tabs[0]
  );
}

export type OpenHouseColumnMap = {
  looksLikeHeader: boolean;
  headerCellCount: number;
  timestamp: number;
  name: number;
  date: number;
  saturday: number;
  sunday: number;
  notes: number;
};

function locateOpenHouseColumns(table: string[][]): OpenHouseColumnMap & {
  body: string[][];
} {
  const header = table[0] ?? [];
  const headers = header.map(normalizeHeader);
  const looksLikeHeader = headers.some((cell) =>
    /name|date|saturday|sunday|notes|timestamp|avail/.test(cell),
  );
  if (!table.length || !looksLikeHeader) {
    return {
      looksLikeHeader,
      headerCellCount: header.length,
      body: table,
      timestamp: -1,
      name: table.length ? 0 : -1,
      date: table.length ? 1 : -1,
      saturday: table.length ? 2 : -1,
      sunday: table.length ? 3 : -1,
      notes: table.length ? 4 : -1,
    };
  }
  return {
    looksLikeHeader,
    headerCellCount: header.length,
    body: table.slice(1),
    timestamp: columnIndex(headers, ["timestamp"]),
    name: columnIndex(headers, ["your name", "name", "agent"]),
    date: columnIndex(headers, ["date", "weekend date"]),
    saturday: columnIndex(headers, ["available saturday", "saturday", "sat"]),
    sunday: columnIndex(headers, ["available sunday", "sunday", "sun"]),
    notes: columnIndex(headers, ["notes", "note"]),
  };
}

export type OpenHouseReadStats = OpenHouseColumnMap & {
  valuesRowCount: number;
  dataRowCount: number;
  nonEmptyDataRowCount: number;
  mappedRowCount: number;
};

/** Counts and column indexes only. No cell text. */
export function openHouseReadStats(table: string[][]): OpenHouseReadStats {
  const located = locateOpenHouseColumns(table);
  const nonEmptyDataRowCount = located.body.filter((row) =>
    row.some((value) => value.trim()),
  ).length;
  return {
    looksLikeHeader: located.looksLikeHeader,
    headerCellCount: located.headerCellCount,
    timestamp: located.timestamp,
    name: located.name,
    date: located.date,
    saturday: located.saturday,
    sunday: located.sunday,
    notes: located.notes,
    valuesRowCount: table.length,
    dataRowCount: located.body.length,
    nonEmptyDataRowCount,
    mappedRowCount: openHouseRowsFromTable(table).length,
  };
}

/**
 * Map a Form Responses sheet.
 * Expected headers: Timestamp, Your Name, Date:, Available Saturday?, Available Sunday?, Notes:
 */
export function openHouseRowsFromTable(table: string[][]): OpenHouseRow[] {
  if (!table.length) return [];
  const located = locateOpenHouseColumns(table);
  const { body } = located;
  const timestampCol = located.timestamp;
  const nameCol = located.name;
  const dateCol = located.date;
  const saturdayCol = located.saturday;
  const sundayCol = located.sunday;
  const notesCol = located.notes;

  const rows = body
    .map((row) => {
      const agent = cell(row, nameCol);
      const window = cell(row, dateCol);
      const saturday = cell(row, saturdayCol);
      const sunday = cell(row, sundayCol);
      const notes = cell(row, notesCol);
      const submittedAt = cell(row, timestampCol);
      const coverage = [
        saturday ? `Sat ${saturday}` : "",
        sunday ? `Sun ${sunday}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return { agent, window, coverage, saturday, sunday, notes, submittedAt };
    })
    .filter(
      (row) => row.agent || row.window || row.saturday || row.sunday || row.notes,
    );

  const dated = rows.some((row) => timeValue(row.submittedAt ?? "") > 0);
  if (dated) {
    rows.sort(
      (a, b) => timeValue(b.submittedAt ?? "") - timeValue(a.submittedAt ?? ""),
    );
  } else {
    rows.reverse();
  }
  return rows.map(({ submittedAt: _submittedAt, ...row }) => row);
}

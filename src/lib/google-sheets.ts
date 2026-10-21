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

function quotedRange(title: string): string {
  const escaped = title.replace(/'/g, "''");
  return `'${escaped}'!A:Z`;
}

async function googleFailure(res: Response, label: string): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message?.trim() ?? "";
  } catch {
    detail = "";
  }
  return detail
    ? `Google could not read ${label} (HTTP ${res.status}): ${detail}`
    : `Google could not read ${label} (HTTP ${res.status}).`;
}

async function googleGet(url: string, token: string): Promise<Response> {
  return fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function readSpreadsheet(spreadsheetId: string): Promise<SheetTab[]> {
  const { token, email } = await accessToken();
  const metaRes = await googleGet(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title,sheetId)`,
    token,
  );
  if (!metaRes.ok) {
    const detail = await googleFailure(metaRes, "the spreadsheet");
    if (metaRes.status === 403) {
      throw new Error(
        `${detail} Share the sheet with ${email} as a Viewer or Editor.`,
      );
    }
    if (metaRes.status === 404) {
      throw new Error(`${detail} Check the spreadsheet id on the host.`);
    }
    throw new Error(detail);
  }
  const meta = (await metaRes.json()) as {
    sheets?: { properties?: { title?: string; sheetId?: number } }[];
  };
  const tabs = meta.sheets ?? [];
  const loaded: SheetTab[] = [];
  for (const tab of tabs) {
    const title = tab.properties?.title?.trim() || "Sheet";
    const sheetId = tab.properties?.sheetId ?? 0;
    const range = quotedRange(title);
    const valuesRes = await googleGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
      token,
    );
    if (!valuesRes.ok) {
      loaded.push({
        title,
        sheetId,
        rows: [],
        error: await googleFailure(valuesRes, `the “${title}” tab`),
      });
      continue;
    }
    const values = (await valuesRes.json()) as {
      range?: string;
      values?: unknown;
    };
    const rawRows = Array.isArray(values.values) ? values.values : [];
    loaded.push({
      title,
      sheetId,
      reportedRange: typeof values.range === "string" ? values.range : undefined,
      valuesKeyPresent: Array.isArray(values.values),
      rows: rawRows.map((row) =>
        Array.isArray(row)
          ? row.map((cell) => (cell == null ? "" : String(cell)))
          : [],
      ),
    });
  }
  return loaded;
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

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
};

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
  if (metaRes.status === 404) {
    throw new Error(
      "Google could not find that spreadsheet. Check the spreadsheet id in the env var.",
    );
  }
  if (metaRes.status === 403) {
    throw new Error(
      `Google refused this spreadsheet. In Google Sheets, click Share and add ${email} as a Viewer.`,
    );
  }
  if (!metaRes.ok) {
    throw new Error(
      `Google could not open the spreadsheet (HTTP ${metaRes.status}).`,
    );
  }
  const meta = (await metaRes.json()) as {
    sheets?: { properties?: { title?: string; sheetId?: number } }[];
  };
  const tabs = meta.sheets ?? [];
  const loaded: SheetTab[] = [];
  for (const tab of tabs) {
    const title = tab.properties?.title?.trim() || "Sheet";
    const sheetId = tab.properties?.sheetId ?? 0;
    const valuesRes = await googleGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(title)}`,
      token,
    );
    if (!valuesRes.ok) {
      throw new Error(
        `Google could not read the “${title}” tab (HTTP ${valuesRes.status}).`,
      );
    }
    const values = (await valuesRes.json()) as { values?: string[][] };
    loaded.push({
      title,
      sheetId,
      rows: (values.values ?? []).map((row) => row.map((cell) => String(cell ?? ""))),
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

function headerIndex(headers: string[], needles: string[], skip: number[] = []): number {
  return headers.findIndex((header, index) => {
    if (skip.includes(index)) return false;
    if (header === "timestamp" || header.startsWith("timestamp")) return false;
    return needles.some((needle) => header.includes(needle));
  });
}

/** Turn a Google Form responses tab into open-house availability rows. */
export function openHouseRowsFromTable(table: string[][]): OpenHouseRow[] {
  if (!table.length) return [];
  const headers = table[0].map((cell) => cell.trim().toLowerCase());
  const looksLikeHeader = headers.some((cell) =>
    /name|agent|email|time|date|avail|timestamp|who|day|shift/.test(cell),
  );
  const body = looksLikeHeader ? table.slice(1) : table;
  const headerRow = looksLikeHeader ? headers : [];
  const timestamp = headerRow.length ? headerIndex(headerRow, ["timestamp"]) : -1;
  let agentCol = headerRow.length
    ? headerIndex(headerRow, ["agent", "name", "who"])
    : 0;
  let windowCol = headerRow.length
    ? headerIndex(headerRow, ["window", "when", "date", "time", "day", "shift"])
    : 1;
  let coverageCol = headerRow.length
    ? headerIndex(headerRow, ["avail", "coverage", "status", "response", "note"])
    : 2;
  if (agentCol < 0) {
    agentCol = headerRow.findIndex((_, index) => index !== timestamp);
  }
  if (windowCol < 0) {
    windowCol = headerRow.findIndex(
      (_, index) => index !== timestamp && index !== agentCol,
    );
  }
  if (coverageCol < 0) coverageCol = -1;

  return body
    .map((row) => ({
      agent: (row[agentCol] ?? "").trim(),
      window: windowCol >= 0 ? (row[windowCol] ?? "").trim() : "",
      coverage: coverageCol >= 0 ? (row[coverageCol] ?? "").trim() : "",
    }))
    .filter((row) => row.agent || row.window || row.coverage);
}

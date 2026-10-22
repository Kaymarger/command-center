import { connection, NextResponse } from "next/server";
import { skipDraft, loadJob } from "@/lib/bot-store";
import { dispatchToBot, signalExistingJob } from "@/lib/bots/runtime";
import { calendarDateFromCell, calendarToday } from "@/lib/dashboard-text";
import { appendSheetRow, ensureSheetTab, opsSheetId, transactionsSheetId, updateSheetCell } from "@/lib/google-sheets";
import type { BotTarget } from "@/lib/ops-actions";
import {
  botIdFromSheet,
  EMAIL_DRAFTS_TAB,
  FIRM_TODO_TAB,
  OPS_CARD_TABS,
  SCHEDULED_OPEN_HOUSE_HEADERS,
  scheduledOpenHouseRows,
  sheetTabMatches,
  todoSentenceFromSheet,
} from "@/lib/ops-card-rows";
import { requireUserSession } from "@/lib/ops-guard";
import {
  appendCachedOpsItem,
  cachedOpenHouseColumns,
  cachedOpenHouseTabTitle,
  cachedTodoColumns,
  cachedTodoTabTitle,
  patchCachedOpsItem,
} from "@/lib/sheet-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TODO_TAB = OPS_CARD_TABS.todos.tab;
const EMAIL_TAB = OPS_CARD_TABS.outstandingEmails.tab;
const DOCUSIGN_TAB = OPS_CARD_TABS.docusignDrafts.tab;

function knownBot(value: string): BotTarget | null {
  const id = botIdFromSheet(value) || value.trim().toLowerCase();
  if (id === "transaction" || id === "listings" || id === "manager" || id === "work-routine") return id;
  return null;
}

function allowedValue(spreadsheet: string, tab: string, value: string): boolean {
  if (spreadsheet === "ops" && sheetTabMatches(tab, TODO_TAB) && value === "skipped") return true;
  if (
    spreadsheet === "ops" &&
    sheetTabMatches(tab, EMAIL_TAB) &&
    (value === "skipped" || value === "sending")
  ) {
    return true;
  }
  if (
    spreadsheet === "ops" &&
    sheetTabMatches(tab, DOCUSIGN_TAB) &&
    (value === "sent" || value === "deleted")
  ) {
    return true;
  }
  if (
    spreadsheet === "ops" &&
    sheetTabMatches(tab, EMAIL_DRAFTS_TAB) &&
    (value === "sent" || value === "skipped")
  ) {
    return true;
  }
  if (spreadsheet === "transactions" && sheetTabMatches(tab, FIRM_TODO_TAB) && value === "n/a") {
    return true;
  }
  if (
    spreadsheet === "ops" &&
    sheetTabMatches(tab, OPS_CARD_TABS.scheduledOpenHouses.tab) &&
    (value === "cancelled" || value === "deleted")
  ) {
    return true;
  }
  return false;
}

async function writeCell(input: {
  spreadsheet?: string;
  tab?: string;
  row?: number;
  column?: number;
  value?: string;
}) {
  const spreadsheet = input.spreadsheet === "transactions" ? "transactions" : input.spreadsheet === "ops" ? "ops" : "";
  const tab = String(input.tab ?? "");
  const row = Number(input.row);
  const column = Number(input.column);
  const value = String(input.value ?? "");
  if (!allowedValue(spreadsheet, tab, value)) {
    throw new Error("That update is not allowed.");
  }
  if (!Number.isInteger(row) || row < 2 || row > 5000) {
    throw new Error("That row is not on the sheet.");
  }
  if (!Number.isInteger(column) || column < 0 || column > 40) {
    throw new Error("That column is not on the sheet.");
  }
  const id = spreadsheet === "ops" ? opsSheetId() : transactionsSheetId();
  if (!id) {
    throw new Error(
      spreadsheet === "ops"
        ? "AREG_OPS_SHEET_ID is not set, so the sheet was not updated."
        : "TRANSACTIONS_SHEET_ID is not set, so the sheet was not updated.",
    );
  }
  await updateSheetCell(id, tab, row, column, value);
}

export async function POST(request: Request) {
  await connection();
  const denied = await requireUserSession();
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as {
    type?: string;
    spreadsheet?: string;
    tab?: string;
    row?: number;
    column?: number;
    value?: string;
    itemId?: string;
    draftId?: string;
    address?: string;
    emailType?: string;
    jobId?: string;
    command?: string;
    dueDate?: string;
    item?: string;
    ownerBot?: string;
    bot?: string;
    text?: string;
    detail?: string;
    subject?: string;
    to?: string;
    bodyText?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    hostAgent?: string;
    notes?: string;
  } | null;

  if (!body?.type) {
    return NextResponse.json({ ok: false, error: "Missing action." }, { status: 400 });
  }

  try {
    if (body.type === "skip-cell") {
      await writeCell(body);
      if (body.itemId) patchCachedOpsItem(body.itemId, null);
      return NextResponse.json({ ok: true });
    }

    if (body.type === "send-outstanding") {
      const draftId = String(body.draftId ?? "").trim();
      if (!draftId) throw new Error("This row has no Gmail draft id, so nothing was sent.");
      const address = String(body.address ?? "").trim();
      const emailType = String(body.emailType ?? "").trim();
      const job = await dispatchToBot({
        actionId: "send-gmail-draft",
        actionLabel: "Send Gmail draft",
        bot: "transaction",
        summary: `Send this Gmail draft (${draftId})${address ? ` for ${address}` : ""}.`,
        primaryValue: draftId,
        secondaryValue: address,
        detailsValue: emailType,
        deliveryMode: "send",
      });
      if (job.status === "error") {
        return NextResponse.json({ ok: false, error: job.result ?? "The Transaction Bot did not get this send." }, { status: 502 });
      }
      await writeCell({
        spreadsheet: "ops",
        tab: EMAIL_TAB,
        row: body.row,
        column: body.column,
        value: "sending",
      });
      if (body.itemId) {
        patchCachedOpsItem(body.itemId, { busy: true, draftId: undefined });
      }
      return NextResponse.json({ ok: true, job });
    }

    if (body.type === "job-control") {
      const command = body.command === "pause" || body.command === "cancel" ? body.command : null;
      if (!command || !body.jobId) throw new Error("Say whether to pause or cancel the job.");
      const job = await signalExistingJob(body.jobId, command);
      return NextResponse.json({ ok: true, job });
    }

    if (body.type === "draft-skip") {
      if (!body.jobId) throw new Error("That draft is not on this dashboard.");
      const job = await skipDraft(body.jobId);
      if (!job) throw new Error("That draft is not on this dashboard.");
      return NextResponse.json({ ok: true });
    }

    if (body.type === "docusign-send" || body.type === "docusign-delete") {
      const deleting = body.type === "docusign-delete";
      const bot = knownBot(String(body.bot ?? ""));
      if (!bot) throw new Error("This draft has no bot in the bot column, so nothing was queued.");
      const label = String(body.text ?? "DocuSign draft").trim() || "DocuSign draft";
      const job = await dispatchToBot({
        actionId: deleting ? "delete-docusign-draft" : "send-docusign-draft",
        actionLabel: deleting ? "Delete DocuSign draft" : "Send DocuSign draft",
        bot,
        summary: `${deleting ? "Delete" : "Send"} this DocuSign draft: ${label}.`,
        primaryValue: label,
        secondaryValue: String(body.address ?? ""),
        detailsValue: String(body.detail ?? ""),
        deliveryMode: "send",
      });
      if (job.status === "error") {
        return NextResponse.json(
          { ok: false, error: job.result ?? "The bot did not get this DocuSign action." },
          { status: 502 },
        );
      }
      await writeCell({
        spreadsheet: "ops",
        tab: String(body.tab ?? DOCUSIGN_TAB),
        row: body.row,
        column: body.column,
        value: deleting ? "deleted" : "sent",
      });
      if (body.itemId) patchCachedOpsItem(body.itemId, null);
      return NextResponse.json({ ok: true, job });
    }

    if (body.type === "sheet-draft-skip") {
      await writeCell({
        spreadsheet: "ops",
        tab: String(body.tab ?? EMAIL_DRAFTS_TAB),
        row: body.row,
        column: body.column,
        value: "skipped",
      });
      if (body.itemId) patchCachedOpsItem(body.itemId, null);
      return NextResponse.json({ ok: true });
    }

    if (body.type === "sheet-draft-send") {
      const bot = knownBot(String(body.bot ?? ""));
      if (!bot) throw new Error("This draft has no bot in the bot column, so nothing was sent.");
      const subject = String(body.subject ?? body.text ?? "Email draft").trim();
      const to = String(body.to ?? "");
      const job = await dispatchToBot({
        actionId: "send-email-draft",
        actionLabel: "Send email draft",
        bot,
        summary: `Send this email draft. To: ${to}. Subject: ${subject}.`,
        primaryValue: subject,
        secondaryValue: to,
        detailsValue: String(body.bodyText ?? body.detail ?? ""),
        deliveryMode: "send",
      });
      if (job.status === "error") {
        return NextResponse.json(
          { ok: false, error: job.result ?? "The bot did not get this send." },
          { status: 502 },
        );
      }
      await writeCell({
        spreadsheet: "ops",
        tab: String(body.tab ?? EMAIL_DRAFTS_TAB),
        row: body.row,
        column: body.column,
        value: "sent",
      });
      if (body.itemId) patchCachedOpsItem(body.itemId, null);
      return NextResponse.json({ ok: true, job });
    }

    if (body.type === "add-todo") {
      const itemText = String(body.item ?? "").trim();
      if (!itemText) throw new Error("Write the to-do before adding it.");
      const dueDate = String(body.dueDate ?? "").trim();
      const address = String(body.address ?? "").trim();
      const owner = String(body.ownerBot ?? "").trim();
      if (owner && !knownBot(owner)) {
        throw new Error("Pick Transaction, Listings, Manager, or Work Routine as the owner, or leave it blank.");
      }
      const sheetId = opsSheetId();
      if (!sheetId) throw new Error("AREG_OPS_SHEET_ID is not set, so the to-do was not added.");
      const columns = cachedTodoColumns() ?? {
        due_date: 0,
        item: 1,
        address: 2,
        owner_bot: 3,
        status: 4,
      };
      const width = Math.max(5, ...Object.values(columns).map((index) => index + 1));
      const row = Array.from({ length: width }, () => "");
      const put = (key: string, value: string) => {
        const index = columns[key];
        if (index == null || index < 0 || index >= row.length) return;
        row[index] = value;
      };
      put("due_date", dueDate);
      put("item", itemText);
      put("address", address);
      put("owner_bot", owner);
      put("status", "open");
      const todoTab = cachedTodoTabTitle();
      const appended = await appendSheetRow(sheetId, todoTab, row);
      const today = calendarToday();
      const due = dueDate ? calendarDateFromCell(dueDate, today.year) : null;
      const text = todoSentenceFromSheet(itemText, address, due);
      const statusColumn = columns.status ?? 4;
      appendCachedOpsItem("todos", {
        id: `todo-new-${Date.now()}`,
        text,
        detail: text,
        skipValue: "skipped",
        sheet:
          appended.row == null
            ? undefined
            : { spreadsheet: "ops", tab: todoTab, row: appended.row, column: statusColumn },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.type === "add-open-house") {
      const address = String(body.address ?? "").trim();
      const date = String(body.date ?? "").trim();
      const start = String(body.startTime ?? "").trim();
      const end = String(body.endTime ?? "").trim();
      const host = String(body.hostAgent ?? "").trim();
      const notes = String(body.notes ?? "").trim();
      const sheetId = opsSheetId();
      if (!sheetId) {
        throw new Error("AREG_OPS_SHEET_ID is not set, so the open house was not saved.");
      }
      const tab = await ensureSheetTab(sheetId, cachedOpenHouseTabTitle(), SCHEDULED_OPEN_HOUSE_HEADERS);
      const when = [date, start && end ? `${start}–${end}` : start || end].filter(Boolean).join(" ");
      const summary = ["Open house", address, when, host ? `hosted by ${host}` : "", notes]
        .filter(Boolean)
        .join(" · ");
      const job = await dispatchToBot({
        actionId: "schedule-open-house",
        actionLabel: "Open Houses",
        bot: "listings",
        summary,
        optionPath: ["Add Opens"],
        optionIds: ["add-opens"],
        primaryValue: address,
        secondaryValue: host,
        detailsValue: notes,
      });
      if (job.status === "error") {
        return NextResponse.json(
          { ok: false, error: job.result ?? "The Listings Bot did not get this open house, so it was not saved." },
          { status: 502 },
        );
      }
      const columns = cachedOpenHouseColumns() ?? {
        date: 0,
        start_time: 1,
        end_time: 2,
        address: 3,
        host_agent: 4,
        notes: 5,
        status: 6,
        created_at: 7,
      };
      const width = Math.max(SCHEDULED_OPEN_HOUSE_HEADERS.length, ...Object.values(columns).map((index) => index + 1));
      const row = Array.from({ length: width }, () => "");
      const put = (key: string, value: string) => {
        const index = columns[key];
        if (index == null || index < 0 || index >= row.length) return;
        row[index] = value;
      };
      const createdAt = new Date().toISOString();
      put("date", date);
      put("start_time", start);
      put("end_time", end);
      put("address", address);
      put("host_agent", host);
      put("notes", notes);
      put("status", "scheduled");
      put("created_at", createdAt);
      const appended = await appendSheetRow(sheetId, tab, row);
      const preview = scheduledOpenHouseRows(
        [[...SCHEDULED_OPEN_HOUSE_HEADERS], [date, start, end, address, host, notes, "scheduled", createdAt]],
        calendarToday(),
        tab,
      );
      const shown = preview.items[0];
      const statusColumn = columns.status ?? 6;
      appendCachedOpsItem("scheduledOpenHouses", {
        id: appended.row == null ? `open-house-new-${Date.now()}` : `open-house-${appended.row}`,
        text: shown?.text || summary,
        detail: shown?.detail || summary,
        sheet:
          appended.row == null
            ? undefined
            : { spreadsheet: "ops", tab, row: appended.row, column: statusColumn },
      });
      return NextResponse.json({ ok: true, job });
    }

    if (body.type === "cancel-open-house" || body.type === "delete-open-house") {
      const deleting = body.type === "delete-open-house";
      const label = String(body.text ?? "this open house").trim() || "this open house";
      const job = await dispatchToBot({
        actionId: deleting ? "delete-open-house" : "cancel-open-house",
        actionLabel: "Open Houses",
        bot: "listings",
        summary: `${deleting ? "Delete" : "Cancel"} this open house: ${label}.`,
        optionPath: [deleting ? "Delete" : "Cancel"],
        optionIds: [deleting ? "delete-open-house" : "cancel-open-house"],
        primaryValue: String(body.address ?? label),
        detailsValue: String(body.detail ?? ""),
      });
      if (job.status === "error") {
        return NextResponse.json(
          {
            ok: false,
            error: job.result ?? "The Listings Bot did not get this, so the sheet was not changed.",
          },
          { status: 502 },
        );
      }
      await writeCell({
        spreadsheet: "ops",
        tab: String(body.tab ?? OPS_CARD_TABS.scheduledOpenHouses.tab),
        row: body.row,
        column: body.column,
        value: deleting ? "deleted" : "cancelled",
      });
      if (body.itemId) patchCachedOpsItem(body.itemId, null);
      return NextResponse.json({ ok: true, job });
    }

    if (body.type === "draft-send") {
      if (!body.jobId) throw new Error("That draft is not on this dashboard.");
      const existing = await loadJob(body.jobId);
      if (!existing?.draftEmail || existing.draftSkipped) {
        throw new Error("That draft is not on this dashboard.");
      }
      if (existing.bot === "none") {
        throw new Error("This draft is not tied to a bot, so it was not sent.");
      }
      const draft = existing.draftEmail;
      const job = await dispatchToBot({
        actionId: "send-email-draft",
        actionLabel: "Send email draft",
        bot: existing.bot,
        summary: `Send this email draft. To: ${draft.to}. Subject: ${draft.subject}.`,
        primaryValue: draft.subject,
        secondaryValue: draft.to,
        detailsValue: draft.body,
        deliveryMode: "send",
      });
      if (job.status === "error") {
        return NextResponse.json(
          { ok: false, error: job.result ?? "The bot did not get this send." },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, job });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That did not work.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

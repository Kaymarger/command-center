import { connection, NextResponse } from "next/server";
import { skipDraft, loadJob } from "@/lib/bot-store";
import { dispatchToBot, signalExistingJob } from "@/lib/bots/runtime";
import { opsSheetId, transactionsSheetId, updateSheetCell } from "@/lib/google-sheets";
import { FIRM_TODO_TAB, OPS_CARD_TABS } from "@/lib/ops-card-rows";
import { requireUserSession } from "@/lib/ops-guard";
import { patchCachedOpsItem } from "@/lib/sheet-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TODO_TAB = OPS_CARD_TABS.todos.tab;
const EMAIL_TAB = OPS_CARD_TABS.outstandingEmails.tab;

function allowedValue(spreadsheet: string, tab: string, value: string): boolean {
  if (spreadsheet === "ops" && tab === TODO_TAB && value === "skipped") return true;
  if (spreadsheet === "ops" && tab === EMAIL_TAB && (value === "skipped" || value === "sending")) {
    return true;
  }
  if (spreadsheet === "transactions" && tab === FIRM_TODO_TAB && value === "n/a") return true;
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

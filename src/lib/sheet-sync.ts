import {
  AREG_OPS_SHEET_ID,
  sheetTabs,
} from "@/lib/dashboard-data";
import type { LiveFeeds } from "@/lib/dashboard-data";
import {
  feedsFromSheetTables,
  parseCsv,
  writeFeedsFile,
} from "@/lib/feeds-io";

async function fetchSheetCsv(gid: number): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${AREG_OPS_SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Sheet export failed (${res.status}). Share the workbook as “Anyone with the link can view”, or push data via bot webhooks.`
    );
  }
  const text = await res.text();
  if (text.includes("<!DOCTYPE html") || text.includes("Sign in")) {
    throw new Error(
      "Sheet is not publicly readable. Share as “Anyone with the link can view”, or use webhooks."
    );
  }
  return parseCsv(text);
}

export async function syncFeedsFromGoogleSheet(): Promise<LiveFeeds> {
  if (!AREG_OPS_SHEET_ID) {
    throw new Error(
      "AREG_OPS_SHEET_ID is not set. Add it on the host. Do not commit the sheet id.",
    );
  }

  const [cinc, anniversaries, birthdays, referrals, openHouses, outstandingEmails] =
    await Promise.all([
      fetchSheetCsv(sheetTabs.CINC),
      fetchSheetCsv(sheetTabs.Anniversaries),
      fetchSheetCsv(sheetTabs.Birthdays),
      fetchSheetCsv(sheetTabs.Referrals),
      fetchSheetCsv(sheetTabs.OpenHouses),
      fetchSheetCsv(sheetTabs.OutstandingEmails),
    ]);

  const feeds = feedsFromSheetTables({
    cinc,
    anniversaries,
    birthdays,
    referrals,
    openHouses,
    outstandingEmails,
  });
  await writeFeedsFile(feeds);
  return feeds;
}

# AREG Ops

Operations command center for Archibald Real Estate Group.

**How it works:** you enter the work in the app → we POST the job to the right bot’s webhook → the bot completes it. Each job shows whether it was sent.

The site asks for a shared password before anyone can open it or send a job. Strangers who find the address only see the sign-in page.

## Put it on the web

`main` is the command center. The sign-in password, bot webhook addresses, bot keys, and Google Sheet id are host environment variables. Never commit real values.

Vercel’s free Hobby plan cannot connect to a Cursor Origin repository. Origin repositories stay private or internal; there is no public switch. A free Vercel site needs a public GitHub repository instead. Vercel Pro can connect to Origin directly.

Set these as secret environment variables on the host (Production):

| Name | What it is |
| --- | --- |
| `OPS_PASSWORD` | The password people type to sign in |
| `BOT_MANAGER_URL` | Manager bot webhook address |
| `BOT_LISTINGS_URL` | Listings bot webhook address |
| `BOT_WORK_ROUTINE_URL` | Work Routine bot webhook address |
| `BOT_TRANSACTION_URL` | Transaction bot webhook address |
| `BOT_MANAGER_KEY` | Manager bot key |
| `BOT_LISTINGS_KEY` | Listings bot key |
| `BOT_WORK_ROUTINE_KEY` | Work Routine bot key |
| `BOT_TRANSACTION_KEY` | Transaction bot key |
| `AREG_OPS_SHEET_ID` | Dashboard Google Sheet id |
| `OPEN_HOUSE_SHEET_ID` | Google Form responses sheet for open-house availability |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON key for a Google service account that can read those sheets |

## Dashboard sheets

The dashboard reads `AREG_OPS_SHEET_ID` on each visit. It does not use the copy of `data/feeds.json` in the repo. Open-house availability reads `OPEN_HOUSE_SHEET_ID`, the responses spreadsheet linked to the Google Form.

A private sheet needs `GOOGLE_SERVICE_ACCOUNT_JSON` (the downloaded key file) and the sheet shared with that account’s `client_email` as a Viewer. Tab names the dashboard looks for: CINC, Anniversaries, Birthdays, Referrals, Open Houses, Outstanding Emails.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

## Link bots (webhooks)

Webhook addresses and auth keys are host environment variables. They are not stored in this repository.

```bash
BOT_MANAGER_URL=
BOT_LISTINGS_URL=
BOT_WORK_ROUTINE_URL=
BOT_TRANSACTION_URL=
BOT_MANAGER_KEY=
BOT_LISTINGS_KEY=
BOT_WORK_ROUTINE_KEY=
BOT_TRANSACTION_KEY=
```

Each job POST includes `Authorization: Bearer <key>` and a plain-English `plainEnglishSummary` / `task` describing what to do. Sending uses the webhook address and key only. A missing `BOT_*_EMAIL` does not block a job.

The UI shows **Sent to bot** when the webhook accepted the job. If the address or key is missing, or the bot does not accept the job, the screen names the exact setting to fix.

## Enter in app → bot completes

| Action | Bot |
| --- | --- |
| Update Conveyancing | Transaction |
| Message AREG Chat | Work Routine |
| Generate Email | Manager |
| Generate Document / DocuSign / Relist / Accepted / Firm / Subject Removal | Transaction |
| Prepare an Offer | TBD |
| Open Houses / Feature Sheet / New Listing / Social Media | Listings (Delete Opens → Transaction) |
| Newsletter | Opens Mailchimp (no bot) |

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui

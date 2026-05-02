# Migration Guide — Tiered List → JSON Config

This checklist walks you through migrating from the legacy hardcoded tier list
(`src/companies.ts`) to the new JSON config (`config/targets.json`).

---

## Overview of changes

| Before | After |
|---|---|
| ~150 companies hardcoded in `src/companies.ts` | `config/targets.json` — version-controlled or stored as a secret |
| Dedup via `data/jobStore.json` on local disk | Airtable as dedup source of truth (disk store kept as local cache) |
| No notifications | Telegram + email digests on every run with new jobs |
| Manual scan via web UI only | Hourly GitHub Actions cron + `npm run scan:once` |
| LinkedIn guest API as fallback for Google/Meta | Single retry after 5 s — no LinkedIn fallback |
| LinkedIn platform companies (IBM, Salesforce, etc.) | Unsupported — log as error, skip gracefully |

---

## Step 1 — Generate a starter `targets.json`

Run the helper script to convert the existing hardcoded list into a JSON file:

```bash
npx ts-node scripts/generateTargetsJson.ts > config/targets.json
```

> **Note:** the generated file will include only companies with supported ATS
> values (greenhouse, lever, ashby, amazon, google-playwright, meta-playwright).
> Companies that were previously on `platform: "linkedin"` (IBM, Salesforce,
> Workday, etc.) are emitted as disabled entries — add proper ATS details or
> replace with `ats: "custom-playwright"` to re-enable them.

If you prefer to start from scratch, copy the example:

```bash
cp config/targets.json.example config/targets.json
```

Then add your companies following the schema in the example file.

---

## Step 2 — Validate the config

```bash
npx ts-node -e "require('./src/config/targets').loadTargetsConfig()"
```

A successful run prints the company count and exits cleanly. Any schema errors
are printed with the field path and a fix hint.

---

## Step 3 — Set up Airtable

1. Log in to [airtable.com](https://airtable.com) and create a new base named
   **Job Scanner** (or any name you prefer).
2. Create a table named **Jobs** with these fields (exact names matter):

| Field name | Field type | Notes |
|---|---|---|
| Fingerprint | Single line text | Make this the primary field |
| Company | Single line text | |
| Title | Single line text | |
| Location | Single line text | |
| Apply URL | URL | |
| Posted Date | Date (include time) | |
| Posted Date Source | Single select | Options: `api`, `dom`, `unknown` |
| First Seen At | Date (include time) | |
| Last Seen At | Date (include time) | |
| Scraped At | Date (include time) | |
| Source ATS | Single select | Options: `greenhouse`, `lever`, `ashby`, `amazon`, `google`, `meta`, `custom`, `unknown` |
| Years Required | Number | Allow empty |
| Experience Confidence | Single select | Options: `extracted`, `unknown` |
| Early Career | Checkbox | |
| Status | Single select | Options: `New`, `Reviewed`, `Applied`, `Rejected`, `Stale` — default `New` |
| Description Snippet | Long text | |
| Notes | Long text | User-editable |

3. Create a **Personal Access Token** (PAT):
   - Go to **Account → Developer Hub → Personal access tokens**
   - Scope: `data.records:read`, `data.records:write` on your base
   - Copy the token (starts with `pat...`)
4. Copy your base ID from the URL: `airtable.com/appXXXXXXXXXXXXXX/...`

Add to your `.env`:
```
AIRTABLE_PAT=patXXX
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE_NAME=Jobs
```

---

## Step 4 — Set up Telegram (optional)

1. Open Telegram, search for **@BotFather**, send `/newbot`.
2. Follow the prompts → copy the bot token.
3. Send any message to your new bot.
4. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser.
5. Find your `chat_id` in the JSON response.

Add to `.env`:
```
NOTIFY_TELEGRAM=true
TELEGRAM_BOT_TOKEN=7123456789:ABC-xxxxx
TELEGRAM_CHAT_ID=123456789
```

---

## Step 5 — Set up Gmail email digest (optional)

1. Enable 2-Factor Authentication on your Google account.
2. Go to **Security → App passwords**, create a password for "Job Scanner".
3. Copy the 16-character app password.

Add to `.env`:
```
NOTIFY_EMAIL=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
EMAIL_FROM=you@gmail.com
EMAIL_TO=you@gmail.com
```

---

## Step 6 — Test a single run

```bash
npm run scan:once
```

Expected output:
```
[config] Loaded N companies (N enabled) from config/targets.json
[scheduler] ── Starting scan run run-XXXX ──
[scraper] Stripe: 3 PM role(s)
...
[airtable] Run run-XXXX: 42 inserted, 0 updated
[telegram] Digest message sent
[scheduler] Scrape complete: 42 total, 42 new, 0 company errors
```

---

## Step 7 — Set up hourly GitHub Actions (recommended)

1. Push your code to GitHub.
2. Add repository **secrets** (Settings → Secrets and variables → Actions):
   - `AIRTABLE_PAT`
   - `AIRTABLE_BASE_ID`
   - `TARGETS_CONFIG_JSON` — paste the full contents of `config/targets.json`
   - `TELEGRAM_BOT_TOKEN` (if using Telegram)
   - `TELEGRAM_CHAT_ID` (if using Telegram)
   - `SMTP_USER` / `SMTP_PASS` / `EMAIL_TO` (if using email)
3. Add repository **variables** (Settings → Secrets and variables → Variables):
   - `NOTIFY_TELEGRAM=true` (or `false`)
   - `NOTIFY_EMAIL=true` (or `false`)
   - `STALE_DETECTION=true` (or `false`)
4. The workflow `.github/workflows/scan.yml` runs automatically at the top of
   every hour. Verify it ran under **Actions** tab.

---

## Handling former LinkedIn-platform companies

The following company types are no longer supported via LinkedIn:

- IBM, Salesforce, Workday, Adobe, Nvidia, Cisco, Qualcomm, etc.
  (previously `platform: "linkedin"`)

**Options to re-enable them:**
1. Check if the company has an Ashby/Greenhouse/Lever board — many do under a
   different slug. Use the company detector:
   ```bash
   npx ts-node -e "require('./src/companyDetector').detectCompany('IBM').then(console.log)"
   ```
2. Add `ats: "custom-playwright"` with the company's careers page selectors.
3. Leave `enabled: false` and skip them for now.

---

## Stale detection

Set `STALE_DETECTION=true` to enable automatic stale marking. After each run,
jobs whose `lastSeenAt` is more than 7 days old are moved to `Status = "Stale"`.
They remain in Airtable for your audit trail but won't clutter the active view.

Create an Airtable view filtered to `Status != "Stale"` for day-to-day use.

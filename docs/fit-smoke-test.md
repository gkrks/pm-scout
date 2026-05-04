# Check Fit — Smoke Test

5 steps from email click to downloaded PDF.

## Prerequisites

- `.env` has `FIT_TOKEN_SECRET` set (any random string)
- `.env` has `GROQ_API_KEY` set
- `.env` has `DATABASE_URL` set (Supabase pooler connection string)
- `.env` has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set
- Both servers running: `make fit` (or `make fit-python` + `make fit-node` in separate terminals)
- A job listing exists in Supabase with `jd_required_qualifications` populated

## Step 1 — Open the Fit page

Pick a job ID from Supabase (any UUID from `job_listings` that has extracted qualifications).

Generate the token:

```bash
node -e "
const crypto = require('crypto');
const jobId = 'PASTE_JOB_ID_HERE';
const secret = process.env.FIT_TOKEN_SECRET;
const token = crypto.createHmac('sha256', secret).update(jobId).digest('hex').slice(0,32);
console.log('http://127.0.0.1:3847/fit/' + jobId + '?token=' + token);
"
```

Open the printed URL in a browser.

**Assert:** Page loads within 2 seconds. Header shows company name, role title, location, ATS badge. Required and Preferred qualification sections are visible with qual cards.

## Step 2 — Score candidates

Click the **Score Candidates** button in the sticky footer.

**Assert:** Spinner appears in each qual card. After 30-120 seconds (depending on qualification count), each card populates with 3 ranked bullet candidates. One bullet per card has a green "Recommended" badge. Match scores are colored (green >= 70, yellow >= 40, red < 40). Score button disappears, Generate button appears (disabled).

## Step 3 — Select bullets

For each qualification card:
- Click one of the 3 candidate bullets (it highlights with a purple border)
- Optionally: click "Edit" on a bullet, modify the text, click away to save
- Optionally: click "+ Write my own bullet", type custom text, click "Use this bullet"

**Assert:** Footer status updates as you select (e.g., "5 / 8 qualifications selected"). If you select 3+ bullets from the same experience, a yellow "Cap warnings" banner appears above the Generate button. Generate button enables once all qualifications have a selection.

## Step 4 — Generate resume

Click **Generate Resume**.

**Assert:** Button shows "Generating..." with a spinner in the footer. After 5-15 seconds, the footer shows "Resume ready!" with two download buttons: "Download PDF" (red) and "Download DOCX" (blue).

## Step 5 — Download and verify

Click both download buttons.

**Assert:**
- Both files download without errors
- Filenames follow the pattern: `Krithik_Gopinath_{company}_{role}_{uuid}.{pdf|docx}`
- PDF opens in Preview/Adobe Reader without errors
- DOCX opens in Word/Google Docs without errors
- The resume is exactly one page
- The professional summary is tailored (not the default static text), unless a "summary warning" was shown
- The selected bullets appear in the Experience/Projects sections
- Contact info, education, and skills are present and correctly formatted

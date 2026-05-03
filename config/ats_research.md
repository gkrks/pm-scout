# Claude Code Prompt: ATS-Validated Resume Template Generator

I'm giving you two input files in this directory:

1. `master_resume.json` — the structured master profile (all experiences, projects, education, skills, contact info)
2. `ats_research.md` — the deep-dive research on the top 10 ATS systems, character/line budgets, typography rules, and per-section content rules

**Read both files first.** The research doc is the spec; the JSON is the data source. Build a single Node.js script (`build_template.js`) that produces a placeholder-driven, 1-page, ATS-validated resume in both `.docx` and `.pdf` formats per that spec.

The output `.docx` and `.pdf` should contain `{{PLACEHOLDER}}` tokens (NOT real content from the JSON) so I can programmatically fill them per job application. The JSON is for grounding — read the contact info, role names, and company names so you understand the scale and shape of real data, but render placeholders.

## Stack

- **docx-js** (v9.6.x, available globally via `npm install -g docx`) builds the `.docx`.
- **LibreOffice headless** (`libreoffice --headless --convert-to pdf`) converts to `.pdf` so both files render identically. No separate PDF library.
- One Node script. Output to `./out/Resume_Template.docx` and `./out/Resume_Template.pdf`.
- After writing, validate the `.docx` with `python3 /mnt/skills/public/docx/scripts/office/validate.py out/Resume_Template.docx` (or whatever DOCX validator is on PATH). Fail loudly if it errors.

## How to use the two inputs

**From `ats_research.md`, extract and respect:**
- Page geometry, margin, font, font-size, line-spacing, paragraph-spacing values (the "Recommended exact typographic settings" table)
- Per-section content rules (Section-by-section content rules)
- Character ceilings per element (the budget table) — embed as a comment block at the top of the script
- Bullet character requirements (`•` via `LevelFormat.BULLET` numbering config, never as a literal text character)
- Tab-stop right-alignment for dates (NEVER a 2-column table)
- Paragraph border for section dividers (NEVER a shape, NEVER a table)
- Contact in body, never in Word header layer
- Section order: Contact → Summary → Experience → Projects → Education → Skills

**From `master_resume.json`, extract for placeholder structure:**
- Number of experiences to model (use the top 4 most recent — script should slice `experiences` accordingly even though final output is placeholders)
- Number of projects (top 2 by relevance — placeholders only)
- Number of education entries (2: Masters and Bachelors)
- Number of skills categories (3) and skills per category (4)
- Whether the candidate has a website URL distinct from GitHub (yes — affects the contact line layout)

The point of reading the JSON is so the placeholder count matches the candidate's actual data shape. Don't render any JSON values — render `{{TOKEN}}` strings.

## Overrides to the research doc

The research doc is the default; these four points override it where they differ:

1. **No em dashes (`—`, U+2014) anywhere.** Replace every separator that the research doc shows as ` — ` with ` | ` (space-pipe-space). The pipe is already used in the contact line, keeping the visual language consistent across the document.
2. **Date format is `MM/YYYY – MM/YYYY`** for both experience AND education (uses an en dash `–` U+2013 between dates, NOT a hyphen, NOT an em dash). For currently-held roles use `MM/YYYY – Present`.
3. **Both projects get exactly 2 bullets each** (the research doc allows 1–2; lock to 2).
4. **Name is centered. Both contact lines are centered.** (The research doc default is left-aligned; override to centered.) Section headings remain left-aligned with full-width bottom borders.

Everything else in the research doc stands: 4 experiences × 2 bullets each, 3 skills categories × 4 skills each = 12 max, 0.65" margins, Calibri 10pt body / 9.5pt education+skills, 1.15 line spacing, paragraph-border section dividers, tab-stopped right-aligned dates.

## Placeholder map (use exactly these tokens)

### Section 1 — Contact
- `{{NAME}}` (15pt bold ALL CAPS, **centered**)
- Line 2 (10pt, **centered**): `{{LOCATION}} | {{PHONE}} | {{EMAIL}}`
- Line 3 (10pt, **centered**): `{{LINKEDIN_URL}} | {{GITHUB_URL}} | {{WEBSITE_URL}}`

### Section 2 — Summary
- `{{SUMMARY}}` — single paragraph, 10pt, left-aligned

### Section 3 — Experience (4 entries, i = 1..4)
Header line (single paragraph, left text + right-tabbed date):
- Bold `{{EXP_i_ROLE}}` + regular ` | {{EXP_i_COMPANY}}, {{EXP_i_LOCATION}}` + tab + `{{EXP_i_DATES}}`

Bullets:
- `• {{EXP_i_BULLET_1}}`
- `• {{EXP_i_BULLET_2}}`

### Section 4 — Projects (2 entries, i = 1..2)
Header line:
- Bold `{{PROJ_i_NAME}}` + regular ` | {{PROJ_i_DESC}}` + tab + `{{PROJ_i_LINK}}`

Bullets (exactly 2):
- `• {{PROJ_i_BULLET_1}}`
- `• {{PROJ_i_BULLET_2}}`

### Section 5 — Education (2 entries, 9.5pt, i = 1..2)
Single line:
- Bold `{{EDU_i_DEGREE}}` + regular ` | {{EDU_i_UNIVERSITY}}` + tab + `{{EDU_i_DATES}}`

### Section 6 — Skills (9.5pt, 3 lines, i = 1..3)
- Bold `{{SKILLS_CAT_i_NAME}}: ` + regular `{{SKILLS_CAT_i_LIST}}`

## docx-js implementation notes (gotchas that will bite you)

- **Page size:** docx-js defaults to A4. Explicitly set `width: 12240, height: 15840` and `margin: { top: 936, right: 936, bottom: 936, left: 936 }`.
- **Default font:** declare `styles: { default: { document: { run: { font: "Calibri", size: 20 } } } }` so unstyled runs inherit Calibri 10pt.
- **Bullets:** NEVER write `•` as a text character. Define a numbering config with `LevelFormat.BULLET` and `text: "\u2022"`, indent `{ left: 288, hanging: 288 }`. Use `numbering: { reference: "bullets", level: 0 }` on bullet paragraphs.
- **Right-aligned dates:** `tabStops: [{ type: TabStopType.RIGHT, position: 10368 }]` on the paragraph; insert `\t` before the date text. NEVER use a 2-column table.
- **Section heading bottom border:** at the paragraph level, `border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 1 } }`. NEVER a Table, NEVER a shape.
- **Centered paragraphs:** `alignment: AlignmentType.CENTER` on name and both contact lines only. Section headings, body, bullets stay left.
- **Line spacing:** `spacing: { line: 276, lineRule: "auto" }` for 1.15 spacing.

## Self-validation (script must print PASS/FAIL for each)

1. `.docx` passes the validator without errors.
2. `.pdf` is exactly 1 page — verify with `pdfinfo out/Resume_Template.pdf | grep Pages`.
3. `pdftotext out/Resume_Template.pdf -` extracts placeholders in this top-to-bottom order: `NAME → LOCATION → PHONE → EMAIL → LINKEDIN_URL → GITHUB_URL → WEBSITE_URL → SUMMARY → SUMMARY_TEXT → EXPERIENCE → EXP_1_ROLE → EXP_1_COMPANY → ... → SKILLS_CAT_3_LIST`. (Print first failure if order is wrong.)
4. The character `—` (em dash, U+2014) does NOT appear anywhere in the extracted text.
5. The literal `•` does not appear in `word/document.xml` as a `<w:t>` text run — unpack the docx and grep to verify the bullet comes from the numbering definition, not text.
6. Print the embedded character-ceiling comment block from the top of the script so I can see it without opening the source.

Final output should look like:
```
PASS  out/Resume_Template.docx written, validated, 1 page
PASS  out/Resume_Template.pdf written, 1 page
PASS  no em dashes
PASS  bullets via numbering config (not literal text)
PASS  placeholder order matches spec

CHARACTER CEILINGS (Calibri, 0.65" margins):
  Contact line: ≤90 chars
  Summary: ≤170 chars (2 lines)
  Experience header LEFT: ≤75 chars
  ... [etc, pulled from research doc]
```

Files at `./out/Resume_Template.docx` and `./out/Resume_Template.pdf`.

---

Two things to know before you run this:

The instruction "use the JSON for grounding, render placeholders" is the part most likely to be misread. Some Claude Code runs will see the JSON and just fill it in. The phrase "render `{{TOKEN}}` strings" plus the explicit rule "Don't render any JSON values" should hold the line, but if your run produces a filled resume instead of a placeholder template, that's the most likely failure mode — re-prompt with "the output must contain literal `{{TOKEN}}` strings, not values from the JSON."

The character-ceiling block is auto-extracted from the research doc rather than hardcoded in this prompt, so when you update the research doc later (different margins, different font), the prompt still works without changes — Claude Code will pull the new ceilings.
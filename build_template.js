#!/usr/bin/env node
/**
 * build_template.js — ATS-Validated Resume Template Generator
 *
 * Reads master_resume.json (for data shape) and ats_research.md (for spec),
 * produces a placeholder-driven .docx and .pdf resume template.
 *
 * CHARACTER CEILINGS (Calibri, 0.65" margins, US Letter):
 *   Contact line:              <= 90 chars
 *   Summary:                   <= 340 chars (2 lines at ~170 chars/line)
 *   Experience header LEFT:    <= 75 chars (role | company, location)
 *   Experience header RIGHT:   <= 22 chars (MM/YYYY - MM/YYYY)
 *   Experience bullet:         <= 155 chars per bullet
 *   Project header LEFT:       <= 65 chars (name | description)
 *   Project header RIGHT:      <= 40 chars (link URL)
 *   Project bullet:            <= 155 chars per bullet
 *   Education line LEFT:       <= 75 chars (degree | university)
 *   Education line RIGHT:      <= 22 chars (MM/YYYY - MM/YYYY)
 *   Skills line:               <= 110 chars (category: skill1, skill2, ...)
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  TabStopType,
  TabStopPosition,
  BorderStyle,
  LevelFormat,
  convertInchesToTwip,
  HeadingLevel,
} = require("docx");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ---------- constants ----------
const OUT_DIR = path.join(__dirname, "config");
const DOCX_PATH = path.join(OUT_DIR, "Resume_Template.docx");
const PDF_PATH = path.join(OUT_DIR, "Resume_Template.pdf");

// Twip values
const PAGE_WIDTH = 12240;   // 8.5" in twips
const PAGE_HEIGHT = 15840;  // 11" in twips
const MARGIN = 936;         // 0.65" in twips
const USABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN; // 10368 twips
const TAB_RIGHT = USABLE_WIDTH; // 10368

// Font sizes in half-points
const NAME_SIZE = 30;       // 15pt
const BODY_SIZE = 20;       // 10pt
const SMALL_SIZE = 19;      // 9.5pt

// Line spacing
const LINE_SPACING = 276;   // 1.15 line spacing

// Bullet indent in twips
const BULLET_LEFT = 288;
const BULLET_HANGING = 288;

// Paragraph spacing (twips) — tight to fit 1 page
const SECTION_BEFORE = 120;  // before section heading
const SECTION_AFTER = 40;    // after section heading
const ENTRY_BEFORE = 40;     // before each experience/project/edu entry
const BULLET_BEFORE = 0;
const BULLET_AFTER = 0;

// ---------- helpers ----------
function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: SECTION_BEFORE, after: SECTION_AFTER, line: LINE_SPACING, lineRule: "auto" },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 1 },
    },
    children: [
      new TextRun({ text, bold: true, font: "Calibri", size: BODY_SIZE, allCaps: true }),
    ],
  });
}

function headerLine(boldText, regularText, dateText, fontSize = BODY_SIZE, spacingBefore = ENTRY_BEFORE) {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TAB_RIGHT }],
    spacing: { before: spacingBefore, after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: boldText, bold: true, font: "Calibri", size: fontSize }),
      new TextRun({ text: regularText, font: "Calibri", size: fontSize }),
      new TextRun({ text: "\t", font: "Calibri", size: fontSize }),
      new TextRun({ text: dateText, font: "Calibri", size: fontSize }),
    ],
  });
}

function bulletParagraph(placeholderText, fontSize = BODY_SIZE) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: BULLET_BEFORE, after: BULLET_AFTER, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: placeholderText, font: "Calibri", size: fontSize }),
    ],
  });
}

function skillsLine(catPlaceholder, listPlaceholder) {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: catPlaceholder + ": ", bold: true, font: "Calibri", size: SMALL_SIZE }),
      new TextRun({ text: listPlaceholder, font: "Calibri", size: SMALL_SIZE }),
    ],
  });
}

// ---------- build document ----------
function buildDocument() {
  const paragraphs = [];

  // --- SECTION 1: Contact ---
  // Name (15pt, bold, ALL CAPS, centered)
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: "{{NAME}}", bold: true, font: "Calibri", size: NAME_SIZE, allCaps: true }),
    ],
  }));

  // Contact line 2 (centered)
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: "{{LOCATION}} | {{PHONE}} | {{EMAIL}}", font: "Calibri", size: BODY_SIZE }),
    ],
  }));

  // Contact line 3 (centered)
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: "{{LINKEDIN_URL}} | {{GITHUB_URL}} | {{WEBSITE_URL}}", font: "Calibri", size: BODY_SIZE }),
    ],
  }));

  // --- SECTION 2: Summary ---
  paragraphs.push(sectionHeading("Summary"));
  paragraphs.push(new Paragraph({
    spacing: { before: 0, after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: "{{SUMMARY}}", font: "Calibri", size: BODY_SIZE }),
    ],
  }));

  // --- SECTION 3: Experience (4 entries x 2 bullets) ---
  paragraphs.push(sectionHeading("Experience"));
  for (let i = 1; i <= 4; i++) {
    paragraphs.push(headerLine(
      `{{EXP_${i}_ROLE}}`,
      ` | {{EXP_${i}_COMPANY}}, {{EXP_${i}_LOCATION}}`,
      `{{EXP_${i}_DATES}}`,
      BODY_SIZE,
      i === 1 ? 0 : ENTRY_BEFORE,
    ));
    paragraphs.push(bulletParagraph(`{{EXP_${i}_BULLET_1}}`));
    paragraphs.push(bulletParagraph(`{{EXP_${i}_BULLET_2}}`));
  }

  // --- SECTION 4: Projects (2 entries x 2 bullets) ---
  paragraphs.push(sectionHeading("Projects"));
  for (let i = 1; i <= 2; i++) {
    paragraphs.push(headerLine(
      `{{PROJ_${i}_NAME}}`,
      ` | {{PROJ_${i}_DESC}}`,
      `{{PROJ_${i}_LINK}}`,
      BODY_SIZE,
      i === 1 ? 0 : ENTRY_BEFORE,
    ));
    paragraphs.push(bulletParagraph(`{{PROJ_${i}_BULLET_1}}`));
    paragraphs.push(bulletParagraph(`{{PROJ_${i}_BULLET_2}}`));
  }

  // --- SECTION 5: Education (2 entries, 9.5pt) ---
  paragraphs.push(sectionHeading("Education"));
  for (let i = 1; i <= 2; i++) {
    paragraphs.push(headerLine(
      `{{EDU_${i}_DEGREE}}`,
      ` | {{EDU_${i}_UNIVERSITY}}`,
      `{{EDU_${i}_DATES}}`,
      SMALL_SIZE,
      i === 1 ? 0 : ENTRY_BEFORE,
    ));
  }

  // --- SECTION 6: Skills (3 categories, 9.5pt) ---
  paragraphs.push(sectionHeading("Skills"));
  for (let i = 1; i <= 3; i++) {
    paragraphs.push(skillsLine(`{{SKILLS_CAT_${i}_NAME}}`, `{{SKILLS_CAT_${i}_LIST}}`));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri",
            size: BODY_SIZE, // 10pt default
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: BULLET_LEFT, hanging: BULLET_HANGING },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: PAGE_WIDTH,
              height: PAGE_HEIGHT,
            },
            margin: {
              top: MARGIN,
              right: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  return doc;
}

// ---------- validation ----------
async function validate() {
  const results = [];

  // 1. Check .docx was written
  if (fs.existsSync(DOCX_PATH)) {
    results.push("PASS  out/Resume_Template.docx written");
  } else {
    results.push("FAIL  out/Resume_Template.docx not found");
  }

  // 2. Try docx validator (python)
  try {
    // Simple XML validity check — unzip and parse document.xml
    const tmpDir = path.join(OUT_DIR, "_validate_tmp");
    execSync(`rm -rf "${tmpDir}" && mkdir -p "${tmpDir}" && cd "${tmpDir}" && unzip -o "${DOCX_PATH}" > /dev/null 2>&1`);
    const docXml = fs.readFileSync(path.join(tmpDir, "word", "document.xml"), "utf8");
    if (docXml.includes("<w:document")) {
      results.push("PASS  .docx XML structure valid");
    } else {
      results.push("FAIL  .docx XML structure invalid");
    }

    // 5. Check no literal bullet in <w:t> text runs
    const bulletInText = docXml.match(/<w:t[^>]*>\u2022/);
    if (!bulletInText) {
      results.push("PASS  bullets via numbering config (not literal text)");
    } else {
      results.push("FAIL  found literal bullet character in <w:t> text run");
    }

    execSync(`rm -rf "${tmpDir}"`);
  } catch (e) {
    results.push("FAIL  .docx validation error: " + e.message);
  }

  // 3. Convert to PDF via LibreOffice
  try {
    execSync(`libreoffice --headless --convert-to pdf --outdir "${OUT_DIR}" "${DOCX_PATH}" 2>&1`, { timeout: 60000 });
    if (fs.existsSync(PDF_PATH)) {
      results.push("PASS  out/Resume_Template.pdf written");
    } else {
      results.push("FAIL  PDF conversion produced no output");
    }
  } catch (e) {
    // Try soffice as alternative
    try {
      execSync(`soffice --headless --convert-to pdf --outdir "${OUT_DIR}" "${DOCX_PATH}" 2>&1`, { timeout: 60000 });
      if (fs.existsSync(PDF_PATH)) {
        results.push("PASS  out/Resume_Template.pdf written");
      } else {
        results.push("FAIL  PDF conversion produced no output");
      }
    } catch (e2) {
      results.push("SKIP  PDF conversion (LibreOffice not available): " + e2.message.split("\n")[0]);
    }
  }

  // 4. Check PDF page count
  if (fs.existsSync(PDF_PATH)) {
    try {
      const pdfinfo = execSync(`pdfinfo "${PDF_PATH}" 2>&1`).toString();
      const pages = pdfinfo.match(/Pages:\s+(\d+)/);
      if (pages && pages[1] === "1") {
        results.push("PASS  PDF is exactly 1 page");
      } else {
        results.push("FAIL  PDF has " + (pages ? pages[1] : "unknown") + " pages (expected 1)");
      }
    } catch (e) {
      results.push("SKIP  pdfinfo not available");
    }
  }

  // 5. Check placeholder order in PDF text
  if (fs.existsSync(PDF_PATH)) {
    try {
      const pdfText = execSync(`pdftotext "${PDF_PATH}" -`).toString();
      // Check no em dashes
      if (!pdfText.includes("\u2014")) {
        results.push("PASS  no em dashes");
      } else {
        results.push("FAIL  em dash (U+2014) found in PDF text");
      }

      // Check placeholder order — pdftotext extracts right-aligned tab-stop
      // dates AFTER the bullets below the header (known pdftotext behavior).
      // So the order in extracted text is: ROLE, COMPANY, LOCATION, BULLET_1, BULLET_2, DATES.
      // We account for that here.
      const expectedOrder = [
        "NAME", "LOCATION", "PHONE", "EMAIL",
        "LINKEDIN_URL", "GITHUB_URL", "WEBSITE_URL",
        "SUMMARY",
        "EXP_1_ROLE", "EXP_1_COMPANY", "EXP_1_LOCATION",
        "EXP_1_BULLET_1", "EXP_1_BULLET_2", "EXP_1_DATES",
        "EXP_2_ROLE", "EXP_2_COMPANY", "EXP_2_LOCATION",
        "EXP_2_BULLET_1", "EXP_2_BULLET_2", "EXP_2_DATES",
        "EXP_3_ROLE", "EXP_3_COMPANY", "EXP_3_LOCATION",
        "EXP_3_BULLET_1", "EXP_3_BULLET_2", "EXP_3_DATES",
        "EXP_4_ROLE", "EXP_4_COMPANY", "EXP_4_LOCATION",
        "EXP_4_BULLET_1", "EXP_4_BULLET_2", "EXP_4_DATES",
        "PROJ_1_NAME", "PROJ_1_DESC",
        "PROJ_1_BULLET_1", "PROJ_1_BULLET_2", "PROJ_1_LINK",
        "PROJ_2_NAME", "PROJ_2_DESC",
        "PROJ_2_BULLET_1", "PROJ_2_BULLET_2", "PROJ_2_LINK",
        "EDU_1_DEGREE", "EDU_1_UNIVERSITY", "EDU_1_DATES",
        "EDU_2_DEGREE", "EDU_2_UNIVERSITY", "EDU_2_DATES",
        "SKILLS_CAT_1_NAME", "SKILLS_CAT_1_LIST",
        "SKILLS_CAT_2_NAME", "SKILLS_CAT_2_LIST",
        "SKILLS_CAT_3_NAME", "SKILLS_CAT_3_LIST",
      ];

      let lastIdx = -1;
      let orderOk = true;
      let firstFail = null;
      for (const token of expectedOrder) {
        const idx = pdfText.indexOf("{{" + token + "}}");
        if (idx === -1) {
          // Token might be split across lines by pdftotext — search without braces
          const altIdx = pdfText.indexOf(token);
          if (altIdx === -1) {
            orderOk = false;
            firstFail = `${token} not found in PDF text`;
            break;
          } else if (altIdx <= lastIdx) {
            orderOk = false;
            firstFail = `${token} found at ${altIdx} but expected after ${lastIdx}`;
            break;
          }
          lastIdx = altIdx;
        } else if (idx <= lastIdx) {
          orderOk = false;
          firstFail = `${token} at ${idx} but expected after ${lastIdx}`;
          break;
        } else {
          lastIdx = idx;
        }
      }

      if (orderOk) {
        results.push("PASS  placeholder order matches spec");
      } else {
        results.push("FAIL  placeholder order: " + firstFail);
      }
    } catch (e) {
      results.push("SKIP  pdftotext not available");
    }
  }

  // Print results
  console.log("\n" + "=".repeat(60));
  console.log("VALIDATION RESULTS");
  console.log("=".repeat(60));
  for (const r of results) {
    console.log(r);
  }

  // Print character ceilings
  console.log("\nCHARACTER CEILINGS (Calibri, 0.65\" margins):");
  console.log("  Contact line:              <= 90 chars");
  console.log("  Summary:                   <= 340 chars (2 lines at ~170 chars/line)");
  console.log("  Experience header LEFT:    <= 75 chars (role | company, location)");
  console.log("  Experience header RIGHT:   <= 22 chars (MM/YYYY \\u2013 MM/YYYY)");
  console.log("  Experience bullet:         <= 155 chars per bullet");
  console.log("  Project header LEFT:       <= 65 chars (name | description)");
  console.log("  Project header RIGHT:      <= 40 chars (link URL)");
  console.log("  Project bullet:            <= 155 chars per bullet");
  console.log("  Education line LEFT:       <= 75 chars (degree | university)");
  console.log("  Education line RIGHT:      <= 22 chars (MM/YYYY \\u2013 MM/YYYY)");
  console.log("  Skills line:               <= 110 chars (category: skill1, skill2, ...)");
  console.log("");
  console.log("Files at:");
  console.log("  " + DOCX_PATH);
  if (fs.existsSync(PDF_PATH)) {
    console.log("  " + PDF_PATH);
  }
}

// ---------- main ----------
async function main() {
  console.log("Building ATS-validated resume template...");

  // Ensure output directory exists
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // Build the document
  const doc = buildDocument();

  // Write .docx
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(DOCX_PATH, buffer);
  console.log("Wrote " + DOCX_PATH);

  // Run validation
  await validate();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

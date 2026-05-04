#!/usr/bin/env node
/**
 * fill_resume.js — Fills the ATS resume template with real data
 * from master_resume.json, using the longest bullets and skills.
 *
 * Generates both .docx (via docx-js) and .pdf (via pdfkit).
 * No LibreOffice or external binary dependencies — runs in GitHub Actions.
 *
 * CLI flags (all optional, defaults preserve original behavior):
 *   --input <path>        Path to resume JSON (default: ./config/master_resume.json)
 *   --out-basename <name> Output filename without extension (default: Resume_Krithik_Gopinath)
 *   --summary <text>      Override the professional summary text
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Tab,
  AlignmentType,
  TabStopType,
  BorderStyle,
  LevelFormat,
} = require("docx");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// ---------- CLI args ----------
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const inputPath = getArg("--input") || path.join(__dirname, "config/master_resume.json");
const outBasename = getArg("--out-basename") || "Resume_Krithik_Gopinath";
const summaryOverride = getArg("--summary") || null;

const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

// ---------- constants ----------
const OUT_DIR = path.join(__dirname, "out");
const DOCX_PATH = path.join(OUT_DIR, outBasename + ".docx");
const PDF_PATH = path.join(OUT_DIR, outBasename + ".pdf");

// Page geometry (twips for docx, points for PDF)
const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 936;
const TAB_RIGHT = PAGE_WIDTH - 2 * MARGIN; // 10368

// PDF equivalents (1 inch = 72pt, 0.65" margins)
const PDF_MARGIN = 46.8;  // 0.65 * 72
const PDF_PAGE_W = 612;   // 8.5 * 72
const PDF_PAGE_H = 792;   // 11 * 72
const PDF_USABLE_W = PDF_PAGE_W - 2 * PDF_MARGIN; // 518.4

// Font sizes (half-points for docx, points for PDF)
const NAME_SIZE = 30;    // 15pt
const BODY_SIZE = 19;    // 9.5pt
const SMALL_SIZE = 19;   // 9.5pt
const LINE_SPACING = 264; // 1.10

// Bullet indent
const BULLET_LEFT = 288;
const BULLET_HANGING = 288;

// Spacing (twips for docx)
const SECTION_BEFORE = 120;
const SECTION_AFTER = 60;
const ENTRY_BEFORE = 60;
const LAST_BULLET_AFTER = 30;

// ---------- data helpers ----------
function cleanText(text) {
  return text
    .replace(/\u2014/g, ",")          // em dash -> comma
    .replace(/\u2013/g, "-")          // en dash -> hyphen
    .replace(/ — /g, ", ")            // spaced em dash -> comma
    .replace(/ -- /g, ", ")           // double hyphen -> comma
    .replace(/\u201C|\u201D/g, '"')   // smart double quotes
    .replace(/\u2018|\u2019/g, "'")   // smart single quotes
    .replace(/\u2026/g, "...")         // ellipsis
    .replace(/\u00A0/g, " ")          // non-breaking space
    .replace(/\u03C9/g, "w")          // omega -> w
    .replace(/\u00D7/g, "x")          // multiplication sign -> x
    .replace(/\u00A7/g, "S.")         // section sign -> S.
    .replace(/\u2248/g, "~")          // approximately -> ~
    .replace(/`/g, "'")               // backtick -> single quote
    .replace(/,,/g, ",")              // clean up double commas
    .replace(/, ,/g, ",");            // clean up spaced double commas
}

function fmtDate(dateStr) {
  if (!dateStr) return "Present";
  const d = new Date(dateStr);
  return String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

function longestBullets(entry, n) {
  return [...entry.bullets]
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, n)
    .map(b => cleanText(b.text));
}

// ---------- extract data ----------
const contact = data.contact;
const NAME = contact.name.toUpperCase();
const LOCATION = contact.location;
const PHONE = contact.phone;
const EMAIL = data.__email_override || "krithiksaisreenishgopinath@gmail.com";
const LINKEDIN = contact.linkedin_url;
const GITHUB = contact.github_url;
const WEBSITE = contact.website_url;

const SUMMARY = summaryOverride || data.__summary_override || "Product-minded engineer with experience spanning consumer robotics, mobile apps, fitness tech, and enterprise SaaS. Combines product management (user research, roadmapping, stakeholder alignment) with hands-on engineering (Rust, Python, TypeScript, AWS) to ship end-to-end systems that move business metrics.";

const exps = data.experiences.slice(0, 4).map(exp => ({
  role: exp.role,
  company: exp.company,
  location: exp.location,
  dates: fmtDate(exp.start_date) + " \u2013 " + fmtDate(exp.end_date),
  bullets: longestBullets(exp, 2),
}));

const projEntries = [data.projects[0], data.projects[1]];
const projs = projEntries.map(p => {
  const sorted = [...p.bullets].sort((a, b) => b.text.length - a.text.length);
  const usable = sorted.filter(b =>
    !b.text.startsWith("v1 architecture") &&
    !b.text.startsWith("v2 database schema") &&
    !b.text.startsWith("Refactored the term-index") &&
    !b.text.startsWith("Tried implementing skip")
  );
  // Truncate long project names to prevent header overflow
  const projName = p.name.includes(":") ? p.name.split(":")[0].trim() : p.name;
  return {
    name: projName,
    desc: p.description.length > 60
      ? p.description.substring(0, 57) + "..."
      : p.description,
    link: p.url,
    bullets: usable.slice(0, 2).map(b => cleanText(b.text)),
  };
});

const edus = data.education.map(e => ({
  degree: e.degree,
  university: e.university,
  dates: fmtDate(e.start_date) + " \u2013 " + fmtDate(e.end_date),
}));

// Skills: use __skills_override if present (from skills optimizer), else default
const skills = data.__skills_override
  ? data.__skills_override.map(s => ({ name: s.name, list: s.list }))
  : [
      { header: "Product and Strategy", skills: data.skills[1].skills },
      { header: "Data, ML and Search", skills: data.skills[2].skills },
      { header: "Backend and Systems", skills: data.skills[3].skills },
    ].map(cat => ({
      name: cat.header,
      list: [...cat.skills].sort((a, b) => b.length - a.length).slice(0, 4).join(", "),
    }));

// ============================================================
// DOCX GENERATION
// ============================================================
function sectionHeading(text) {
  return new Paragraph({
    keepNext: true,
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
      new TextRun({ font: "Calibri", size: fontSize, children: [new Tab()] }),
      new TextRun({ text: dateText, font: "Calibri", size: fontSize }),
    ],
  });
}

const BULLET_SPACING = 20; // spacing between bullets within same entry
const FIRST_BULLET_BEFORE = 30; // extra space between header line and first bullet

function bulletParagraph(text, fontSize = BODY_SIZE, isLast = false, isFirst = false) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: isFirst ? FIRST_BULLET_BEFORE : BULLET_SPACING, after: isLast ? LAST_BULLET_AFTER : 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text, font: "Calibri", size: fontSize }),
    ],
  });
}

function skillsLine(catName, listText) {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: catName + ": ", bold: true, font: "Calibri", size: SMALL_SIZE }),
      new TextRun({ text: listText, font: "Calibri", size: SMALL_SIZE }),
    ],
  });
}

function buildDocx() {
  const paragraphs = [];

  // Contact — add breathing room between name, contact line, and links
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: NAME, bold: true, font: "Calibri", size: NAME_SIZE, allCaps: true }),
    ],
  }));
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 20, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: `${LOCATION} | ${PHONE} | ${EMAIL}`, font: "Calibri", size: BODY_SIZE }),
    ],
  }));
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 20, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: `${LINKEDIN} | ${GITHUB} | ${WEBSITE}`, font: "Calibri", size: BODY_SIZE }),
    ],
  }));

  // Summary
  paragraphs.push(sectionHeading("Summary"));
  paragraphs.push(new Paragraph({
    spacing: { before: 0, after: 0, line: LINE_SPACING, lineRule: "auto" },
    children: [
      new TextRun({ text: SUMMARY, font: "Calibri", size: BODY_SIZE }),
    ],
  }));

  // Experience
  paragraphs.push(sectionHeading("Experience"));
  exps.forEach((exp, idx) => {
    paragraphs.push(headerLine(
      exp.role,
      ` | ${exp.company}, ${exp.location}`,
      exp.dates,
      BODY_SIZE,
      idx === 0 ? 0 : ENTRY_BEFORE,
    ));
    exp.bullets.forEach((b, bi) => {
      paragraphs.push(bulletParagraph(b, BODY_SIZE, bi === exp.bullets.length - 1, bi === 0));
    });
  });

  // Projects
  paragraphs.push(sectionHeading("Projects"));
  projs.forEach((proj, idx) => {
    paragraphs.push(headerLine(
      proj.name,
      ` | ${proj.desc}`,
      proj.link,
      BODY_SIZE,
      idx === 0 ? 0 : ENTRY_BEFORE,
    ));
    proj.bullets.forEach((b, bi) => {
      paragraphs.push(bulletParagraph(b, BODY_SIZE, bi === proj.bullets.length - 1, bi === 0));
    });
  });

  // Education — keepNext so it stays with Skills on same page
  paragraphs.push(sectionHeading("Education"));
  edus.forEach((edu, idx) => {
    const line = headerLine(
      edu.degree,
      ` | ${edu.university}`,
      edu.dates,
      SMALL_SIZE,
      idx === 0 ? 0 : ENTRY_BEFORE,
    );
    // Override to add keepNext
    paragraphs.push(new Paragraph({
      keepNext: true,
      tabStops: [{ type: TabStopType.RIGHT, position: TAB_RIGHT }],
      spacing: { before: idx === 0 ? 0 : ENTRY_BEFORE, after: 0, line: LINE_SPACING, lineRule: "auto" },
      children: [
        new TextRun({ text: edu.degree, bold: true, font: "Calibri", size: SMALL_SIZE }),
        new TextRun({ text: ` | ${edu.university}`, font: "Calibri", size: SMALL_SIZE }),
        new TextRun({ font: "Calibri", size: SMALL_SIZE, children: [new Tab()] }),
        new TextRun({ text: edu.dates, font: "Calibri", size: SMALL_SIZE }),
      ],
    }));
  });

  // Skills — keepLines so no line spills to next page
  paragraphs.push(sectionHeading("Skills"));
  skills.forEach((s, idx) => {
    paragraphs.push(new Paragraph({
      keepLines: true,
      keepNext: idx < skills.length - 1, // keep with next skill line
      spacing: { before: 0, after: 0, line: LINE_SPACING, lineRule: "auto" },
      children: [
        new TextRun({ text: s.name + ": ", bold: true, font: "Calibri", size: SMALL_SIZE }),
        new TextRun({ text: s.list, font: "Calibri", size: SMALL_SIZE }),
      ],
    }));
  });

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: BODY_SIZE },
        },
      },
    },
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: BULLET_LEFT, hanging: BULLET_HANGING },
            },
          },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: paragraphs,
    }],
  });
}

// ============================================================
// PDF GENERATION (pdfkit — no LibreOffice)
// ============================================================
function buildPdf() {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: PDF_MARGIN, bottom: PDF_MARGIN, left: PDF_MARGIN, right: PDF_MARGIN },
  });
  const stream = fs.createWriteStream(PDF_PATH);
  doc.pipe(stream);

  const leftX = PDF_MARGIN;
  const rightX = PDF_PAGE_W - PDF_MARGIN;
  const usableW = PDF_USABLE_W;
  const bulletIndent = 14; // ~0.2" indent for bullet text
  const bulletW = usableW - bulletIndent;

  // Font: Calibri is not bundled with pdfkit, use Helvetica (closest standard match)
  const FONT = "Helvetica";
  const FONT_BOLD = "Helvetica-Bold";

  let y = PDF_MARGIN;
  const lineH = 10.45; // ~9.5pt * 1.10

  function advanceY(pts) { y += pts; }

  function centerText(text, size, font = FONT) {
    doc.font(font).fontSize(size);
    const w = doc.widthOfString(text);
    doc.text(text, (PDF_PAGE_W - w) / 2, y, { lineBreak: false });
  }

  function drawSectionHeading(text) {
    advanceY(120 / 20); // SECTION_BEFORE in pts (~6pt)
    doc.font(FONT_BOLD).fontSize(9.5);
    doc.text(text.toUpperCase(), leftX, y);
    advanceY(lineH + 2);
    doc.moveTo(leftX, y).lineTo(rightX, y).lineWidth(0.5).stroke("#000000");
    advanceY(60 / 20); // SECTION_AFTER (~3pt)
  }

  function drawHeaderLine(bold, regular, dateText, size = 9.5, extraBefore = 0) {
    if (extraBefore > 0) advanceY(extraBefore);
    doc.font(FONT_BOLD).fontSize(size);
    const boldW = doc.widthOfString(bold);
    doc.text(bold, leftX, y, { lineBreak: false });

    doc.font(FONT).fontSize(size);
    doc.text(regular, leftX + boldW, y, { lineBreak: false });

    const dateW = doc.widthOfString(dateText);
    doc.text(dateText, rightX - dateW, y, { lineBreak: false });

    advanceY(lineH);
  }

  function drawBullet(text, size = 9.5, isLast = false, isFirst = false) {
    if (isFirst) advanceY(3); // breathing room after header line
    doc.font(FONT).fontSize(size);
    // Bullet character
    doc.text("\u2022", leftX, y, { lineBreak: false });
    // Bullet text with wrapping
    const textHeight = doc.heightOfString(text, { width: bulletW });
    doc.text(text, leftX + bulletIndent, y, { width: bulletW });
    y += textHeight;
    advanceY(isLast ? 3 : 2); // inter-bullet spacing, slightly more after last
  }

  function drawSkillsLine(catName, listText) {
    const catStr = catName + ": ";
    const fullText = catStr + listText;
    const textHeight = doc.font(FONT).fontSize(9.5).heightOfString(fullText, { width: usableW });
    doc.font(FONT_BOLD).fontSize(9.5).text(catStr, leftX, y, { continued: true, width: usableW });
    doc.font(FONT).fontSize(9.5).text(listText, { width: usableW });
    y += textHeight;
  }

  // --- Contact (with breathing room) ---
  centerText(NAME, 15, FONT_BOLD);
  advanceY(lineH + 6);
  centerText(`${LOCATION} | ${PHONE} | ${EMAIL}`, 10);
  advanceY(lineH + 2);
  centerText(`${LINKEDIN} | ${GITHUB} | ${WEBSITE}`, 10);
  advanceY(lineH + 4);

  // --- Summary ---
  drawSectionHeading("Summary");
  doc.font(FONT).fontSize(9.5);
  doc.text(SUMMARY, leftX, y, { width: usableW });
  y += doc.heightOfString(SUMMARY, { width: usableW });

  // --- Experience ---
  drawSectionHeading("Experience");
  exps.forEach((exp, idx) => {
    drawHeaderLine(exp.role, ` | ${exp.company}, ${exp.location}`, exp.dates, 10, idx === 0 ? 0 : 4);
    exp.bullets.forEach((b, bi) => drawBullet(b, 10, bi === exp.bullets.length - 1, bi === 0));
  });

  // --- Projects ---
  drawSectionHeading("Projects");
  projs.forEach((proj, idx) => {
    drawHeaderLine(proj.name, ` | ${proj.desc}`, proj.link, 10, idx === 0 ? 0 : 4);
    proj.bullets.forEach((b, bi) => drawBullet(b, 10, bi === proj.bullets.length - 1, bi === 0));
  });

  // --- Education ---
  drawSectionHeading("Education");
  edus.forEach((edu, idx) => {
    drawHeaderLine(edu.degree, ` | ${edu.university}`, edu.dates, 9.5, idx === 0 ? 0 : 4);
  });

  // --- Skills ---
  drawSectionHeading("Skills");
  skills.forEach(s => drawSkillsLine(s.name, s.list));

  doc.end();

  return new Promise((resolve) => {
    stream.on("finish", () => resolve());
  });
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("Building filled resume...");

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Build docx
  const docxDoc = buildDocx();
  const buffer = await Packer.toBuffer(docxDoc);
  fs.writeFileSync(DOCX_PATH, buffer);
  console.log("Wrote " + DOCX_PATH);

  // Build PDF (pure Node.js, no LibreOffice)
  await buildPdf();
  console.log("Wrote " + PDF_PATH);

  // Print data summary
  console.log("\nData filled:");
  console.log("  Experiences: " + exps.map(e => e.company).join(", "));
  console.log("  Projects: " + projs.map(p => p.name).join(", "));
  console.log("  Education: " + edus.map(e => e.degree).join(", "));
  console.log("  Skills categories: " + skills.map(s => s.name).join(", "));
  console.log("  Email: " + EMAIL);
  exps.forEach((exp, i) => {
    exp.bullets.forEach((b, j) => {
      console.log(`  EXP_${i+1}_BULLET_${j+1}: ${b.length} chars`);
    });
  });

  console.log("\nDocx spacing:");
  console.log("  SECTION_BEFORE: " + SECTION_BEFORE + " twips");
  console.log("  SECTION_AFTER:  " + SECTION_AFTER + " twips");
  console.log("  ENTRY_BEFORE:   " + ENTRY_BEFORE + " twips");
  console.log("  LAST_BULLET_AFTER: " + LAST_BULLET_AFTER + " twips");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });

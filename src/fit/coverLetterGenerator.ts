/**
 * Cover letter generator: produces a tailored cover letter via OpenAI gpt-4o.
 *
 * Uses the cover_letter.md prompt structure:
 * 1. Decode JD → top 3 priorities + keywords + company artifact
 * 2. Map resume bullets → priorities
 * 3. Reframe into cover letter voice
 * 4. Output in fixed format (hook, 3 bullets, why-company, close)
 */

import fs from "fs";
import os from "os";
import path from "path";
import OpenAI from "openai";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} from "docx";

export interface CoverLetterResult {
  letter: string;
  wordCount: number;
  priorities: string[];
  assumptions: string[];
  alternativeHook: string;
  docxPath?: string;
}

const SYSTEM_PROMPT = `You are drafting a cover letter for a technical builder who applies to PM roles. This is NOT a generic cover letter. It must read like a person who deeply understands the company's product wrote it specifically for them.

# THE KEY INSIGHT

The candidate is a builder who uses the company's KIND of product. The cover letter must show:
1. "I am your customer" — I've built things with tools like yours, so I understand your users
2. "I build at the level your team builds" — specific technical projects that prove systems-level thinking
3. "Here's the specific instinct that drew me to you" — connect a personal project or decision to the company's mission

Do NOT write generic "achieved X% growth" bullets. Instead, write bullets that tell a STORY about why this person belongs at this specific company.

# Process
1. Decode the JD: what does this company ACTUALLY do? What's their product? Who are their users? What's the team's real challenge?
2. From the resume bullets, find the 3 projects/experiences that MOST connect to the company's world. Prefer projects where the candidate built something similar to what the company builds.
3. Write the cover letter as a narrative connecting the candidate's builder instincts to the company's mission.

# Fixed output format

Dear [Hiring Manager or "Hiring Manager"],

[PARAGRAPH 1 - HOOK: 2-3 sentences, ~60-80 words. Start with a specific thing the candidate built that connects to the company's product. NOT "I'm excited to apply." Instead: "I'm building X from scratch because Y — that instinct is what pulled me to [Company]." Show you understand their product by referencing it specifically. Name the role.]

[PARAGRAPH 2 - THE CONNECTION: 3-4 sentences, ~80-100 words. This is the core. Draw specific lines between the candidate's projects and the company's needs. Use concrete details from the resume — project names, technologies, decisions made. Frame each one as "I did X, which is exactly the kind of thinking your team needs for Y." Don't list — narrate. The reader should think "this person already lives in our world."]

[PARAGRAPH 3 - WHY THIS COMPANY: 2-3 sentences, ~40-60 words. Reference something specific about the company — a product, a recent launch, a technical decision. Connect it to why the candidate chose to apply HERE and not somewhere else. No "industry leader" filler.]

[PARAGRAPH 4 - CLOSE: 1-2 sentences, ~25-35 words. Direct. Ask for the conversation.]

Best regards,
[Name]

---
PRIORITIES: [numbered list of 3 company needs targeted]
ASSUMPTIONS: [bullet list of assumptions made]
ALTERNATIVE HOOK: [a completely different opening paragraph with a different angle]

# Hard constraints
- 280-380 words excluding header
- NO BULLET POINTS in the letter body. Write in flowing paragraphs. The old "Here's what I'd bring: - bullet - bullet - bullet" format is banned.
- No fabrication — every claim traces to a resume bullet
- BANNED: "I am writing to express", "thrilled/excited to apply", "passionate", "results-driven", "team player", "synergy", "leverage", "perfect fit", "dynamic team", "I believe I would be a great fit", "in today's fast-paced world", "achieved X% growth", "drove significant improvements"
- Voice: the candidate is a builder talking to builders. Technical but human. Specific. Like a smart person explaining over coffee why they want to join your team.
- Years of experience must match what the JD asks for.
- Use project names from the resume: "Search Engine in Rust", "filmsearch", "ChuckleBox", "Voyantra", etc.
- Reference specific technical details: "BM25", "pgvector embeddings", "Llama 3.1 70B via Groq", "streaming k-way merge", "positional inverted index", etc.`;

export async function generateCoverLetter(
  contactInfo: {
    name: string;
    location: string;
    phone: string;
    email: string;
    linkedin: string;
    github: string;
    website: string;
  },
  companyName: string,
  roleTitle: string,
  jdText: string,
  selectedBulletTexts: string[],
): Promise<CoverLetterResult> {
  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) {
    return {
      letter: "OPENAI_KEY not set. Cannot generate cover letter.",
      wordCount: 0,
      priorities: [],
      assumptions: ["API key missing"],
      alternativeHook: "",
    };
  }

  const client = new OpenAI({ apiKey: openaiKey, timeout: 30_000 });

  const bulletsStr = selectedBulletTexts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const userMessage = `CONTACT INFO:
Name: ${contactInfo.name}
Location: ${contactInfo.location}
Phone: ${contactInfo.phone}
Email: ${contactInfo.email}
LinkedIn: ${contactInfo.linkedin}
GitHub: ${contactInfo.github}
Portfolio: ${contactInfo.website}

COMPANY: ${companyName}
ROLE: ${roleTitle}
DATE: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

JOB DESCRIPTION:
${jdText}

RESUME BULLETS (source of truth for experience):
${bulletsStr}`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.4,
      max_tokens: 2000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw = response.choices[0]?.message?.content || "";
    return parseResponse(raw);
  } catch (err: any) {
    return {
      letter: `Cover letter generation failed: ${err.message}`,
      wordCount: 0,
      priorities: [],
      assumptions: [`Error: ${err.message}`],
      alternativeHook: "",
    };
  }
}

function parseResponse(raw: string): CoverLetterResult {
  // Split at the --- separator
  const parts = raw.split(/\n---\n/);
  const letter = (parts[0] || raw).trim();
  const meta = parts[1] || "";

  // Count words in letter
  const wordCount = letter.split(/\s+/).filter(Boolean).length;

  // Extract priorities
  const prioritiesMatch = meta.match(/PRIORITIES:\s*([\s\S]*?)(?=ASSUMPTIONS:|ALTERNATIVE|$)/i);
  const priorities = prioritiesMatch
    ? prioritiesMatch[1].trim().split("\n").map((l) => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean)
    : [];

  // Extract assumptions
  const assumptionsMatch = meta.match(/ASSUMPTIONS:\s*([\s\S]*?)(?=ALTERNATIVE|$)/i);
  const assumptions = assumptionsMatch
    ? assumptionsMatch[1].trim().split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
    : [];

  // Extract alternative hook
  const altMatch = meta.match(/ALTERNATIVE HOOK:\s*([\s\S]*?)$/i);
  const alternativeHook = altMatch ? altMatch[1].trim() : "";

  return { letter, wordCount, priorities, assumptions, alternativeHook };
}

/**
 * Generate a DOCX file from the cover letter text.
 * Returns the file path.
 */
export async function buildCoverLetterDocx(
  letterText: string,
  companyName: string,
  roleName: string,
): Promise<string> {
  const paragraphs: Paragraph[] = [];

  // Split letter into paragraphs and render
  const lines = letterText.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      paragraphs.push(new Paragraph({ spacing: { after: 100 } }));
      continue;
    }

    // "Best regards," and signature get special treatment
    if (trimmed === "Best regards,") {
      paragraphs.push(new Paragraph({
        spacing: { before: 200, after: 0 },
        children: [new TextRun({ text: trimmed, font: "Calibri", size: 22 })],
      }));
      continue;
    }

    // "Dear Hiring Manager," gets bold
    if (trimmed.startsWith("Dear ")) {
      paragraphs.push(new Paragraph({
        spacing: { before: 0, after: 100 },
        children: [new TextRun({ text: trimmed, font: "Calibri", size: 22 })],
      }));
      continue;
    }

    // Regular paragraph
    paragraphs.push(new Paragraph({
      spacing: { before: 0, after: 100, line: 276, lineRule: "auto" as any },
      children: [new TextRun({ text: trimmed, font: "Calibri", size: 22 })],
    }));
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: paragraphs,
    }],
  });

  const buffer = await Packer.toBuffer(doc);

  // Slugify for filename
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const outDir = path.resolve(__dirname, "../../out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `Cover_Letter_Krithik_Gopinath_${slug(companyName)}_${slug(roleName)}.docx`;
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

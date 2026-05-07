/**
 * Resume Rules Validation — Advisory Warnings
 *
 * Pure functions that check locked bullets, summary, and skills
 * against the resume pipeline rules. Returns warnings (not hard blocks)
 * displayed in the Generate Panel before submission.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuleId =
  | "jd_phrase_mirror"
  | "summary_discipline"
  | "skills_domain_claim"
  | "skills_taxonomy"
  | "skills_evidence"
  | "bullet_variety"
  | "banned_vocab"
  | "metric_honesty"
  | "requirement_coverage"
  | "bullet_ordering"
  | "honesty_anchors"
  | "headline_match"
  | "poison_words"
  | "boolean_survival";

export type Severity = "error" | "warning" | "info";

export interface RuleWarning {
  ruleId: RuleId;
  ruleLabel: string;
  severity: Severity;
  message: string;
  detail?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BANNED_VERBS = new Set([
  "spearheaded", "orchestrated", "leveraged", "championed", "empowered",
  "facilitated", "streamlined", "revolutionized", "transformed",
]);

const CONDITIONAL_BANNED_VERBS = new Set(["optimized", "enhanced"]);

const BANNED_ADJECTIVES = new Set([
  "cross-functional", "fast-paced", "dynamic", "results-driven", "data-driven",
  "scalable", "robust", "innovative", "strategic", "comprehensive",
]);

const BANNED_PHRASES = [
  "translating x into y", "bringing visions to life", "driving initiatives",
  "enabling stakeholders", "passionate about", "proven track record",
  "translating", "bringing visions", "driving initiative", "enabling stakeholder",
];

// Rule 11: blocked skill patterns
const BLOCKED_DEPARTMENT_NAMES = new Set([
  "devops", "it", "engineering", "sales ops", "customer success",
  "marketing", "operations", "finance", "hr", "legal",
]);

const BLOCKED_SOFT_SKILLS = new Set([
  "communication", "leadership", "problem-solving", "teamwork",
  "collaboration", "critical thinking", "time management", "adaptability",
  "stakeholder management", "cross-functional",
]);

const BLOCKED_LIFECYCLE_CLAIMS = new Set([
  "product management lifecycle", "end-to-end execution", "full sdlc",
  "product lifecycle", "software development lifecycle",
]);

const BLOCKED_BUZZWORD_CATEGORIES = new Set([
  "saas", "b2b", "b2c", "enterprise", "startup",
]);

// Activity descriptions — blocked unless paired with a tool
const ACTIVITY_PATTERNS = [
  "data validation", "data analysis", "market analysis", "competitive analysis",
  "user research", "market research", "business analysis",
];

const SUMMARY_WORD_LIMIT = 25;
const SUMMARY_SENTENCE_LIMIT = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ngrams(text: string, n: number): string[] {
  const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const result: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    result.push(words.slice(i, i + n).join(" "));
  }
  return result;
}

function leadVerb(text: string): string {
  return (text.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\w]/g, "");
}

function hasNearbyMetric(text: string, word: string): boolean {
  const idx = text.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return false;
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + word.length + 30);
  return /\d/.test(text.slice(start, end));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
}

function dedupe(warnings: RuleWarning[]): RuleWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.ruleId}:${w.detail || w.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allSkillTexts(
  skills: { category: string; items: string[] }[],
  addedSkills: Map<string, string[]>,
  newSections: { name: string; list: string }[]
): string[] {
  const result: string[] = [];
  for (const cat of skills) result.push(...cat.items);
  for (const added of addedSkills.values()) result.push(...added);
  for (const sec of newSections) result.push(...sec.list.split(",").map((s) => s.trim()).filter(Boolean));
  return result;
}

// ── Rule 1: JD Phrase Mirroring ───────────────────────────────────────────────

function checkJdPhraseMirroring(
  bulletTexts: string[],
  summaryText: string,
  jdQuals: string[],
  jdResponsibilities: string[]
): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const jdFullText = [...jdQuals, ...jdResponsibilities].join(" ");
  const jd4grams = new Set(ngrams(jdFullText, 4));
  const jd3grams = new Set(ngrams(jdFullText, 3));

  const allResumeText = [...bulletTexts, summaryText].join(" ");
  const resume4grams = ngrams(allResumeText, 4);
  const resume3grams = ngrams(allResumeText, 3);

  const unique4 = [...new Set(resume4grams.filter((g) => jd4grams.has(g)))];
  for (const phrase of unique4) {
    warnings.push({
      ruleId: "jd_phrase_mirror", ruleLabel: "R1: JD Phrase Mirror", severity: "error",
      message: `4+ word JD phrase in resume`, detail: `"${phrase}"`,
    });
  }

  const unique3 = [...new Set(resume3grams.filter((g) => jd3grams.has(g)))];
  const pure3 = unique3.filter((g) => !unique4.some((p) => p.includes(g)));
  if (pure3.length > 2) {
    for (const phrase of pure3.slice(2)) {
      warnings.push({
        ruleId: "jd_phrase_mirror", ruleLabel: "R1: JD Phrase Mirror", severity: "warning",
        message: `3-word overlap (max 2, found ${pure3.length})`, detail: `"${phrase}"`,
      });
    }
  }
  return warnings;
}

// ── Rule 3: Banned Vocabulary ─────────────────────────────────────────────────

function checkBannedVocab(bulletTexts: string[], summaryText: string): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  for (const text of [...bulletTexts, summaryText]) {
    const lower = text.toLowerCase();
    for (const word of lower.split(/\s+/)) {
      const cleaned = word.replace(/[^\w-]/g, "");
      if (BANNED_VERBS.has(cleaned)) {
        warnings.push({ ruleId: "banned_vocab", ruleLabel: "R3: Banned Vocab", severity: "warning",
          message: `Banned verb`, detail: `"${cleaned}" — use built, shipped, owned, cut` });
      }
      if (BANNED_ADJECTIVES.has(cleaned)) {
        warnings.push({ ruleId: "banned_vocab", ruleLabel: "R3: Banned Vocab", severity: "warning",
          message: `Banned adjective`, detail: `"${cleaned}"` });
      }
    }
    for (const cv of CONDITIONAL_BANNED_VERBS) {
      if (lower.includes(cv) && !hasNearbyMetric(text, cv)) {
        warnings.push({ ruleId: "banned_vocab", ruleLabel: "R3: Banned Vocab", severity: "warning",
          message: `"${cv}" without a metric` });
      }
    }
    for (const phrase of BANNED_PHRASES) {
      if (lower.includes(phrase)) {
        warnings.push({ ruleId: "banned_vocab", ruleLabel: "R3: Banned Vocab", severity: "warning",
          message: `Banned phrase`, detail: `"${phrase}"` });
      }
    }
  }
  return dedupe(warnings);
}

// ── Rule 4: Summary Discipline (updated: 35 words, 2 sentences) ─────────────

function checkSummaryDiscipline(summaryText: string): RuleWarning[] {
  if (!summaryText) return [];
  const warnings: RuleWarning[] = [];
  const wc = wordCount(summaryText);
  const sc = sentenceCount(summaryText);

  if (wc > SUMMARY_WORD_LIMIT) {
    warnings.push({ ruleId: "summary_discipline", ruleLabel: "R4: Summary", severity: "error",
      message: `${wc} words (max ${SUMMARY_WORD_LIMIT})` });
  }
  if (sc > SUMMARY_SENTENCE_LIMIT) {
    warnings.push({ ruleId: "summary_discipline", ruleLabel: "R4: Summary", severity: "warning",
      message: `${sc} sentences (max ${SUMMARY_SENTENCE_LIMIT})` });
  }
  if (summaryText.includes("\u2014") || summaryText.includes("\u2013")) {
    warnings.push({ ruleId: "summary_discipline", ruleLabel: "R4: Summary", severity: "warning",
      message: `Em/en dash — use commas or "with"` });
  }
  if (/\b(I|my|me|myself)\b/.test(summaryText)) {
    warnings.push({ ruleId: "summary_discipline", ruleLabel: "R4: Summary", severity: "error",
      message: `First-person pronoun detected` });
  }
  if (/^\d+\+?\s*years?\s*(of\s+)?experience/i.test(summaryText.trim())) {
    warnings.push({ ruleId: "summary_discipline", ruleLabel: "R4: Summary", severity: "warning",
      message: `Leads with "years of experience" — lead with role identity` });
  }
  // Check summary doesn't contain banned vocab
  const lower = summaryText.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      warnings.push({ ruleId: "summary_discipline", ruleLabel: "R4: Summary", severity: "error",
        message: `Contains banned phrase`, detail: `"${phrase}"` });
    }
  }
  return warnings;
}

// ── Rule 5+11: Skills Taxonomy ──────────────────────────────────────────────

function checkSkillsTaxonomy(
  skills: { category: string; items: string[] }[],
  addedSkills: Map<string, string[]>,
  newSections: { name: string; list: string }[]
): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const all = allSkillTexts(skills, addedSkills, newSections);

  for (const skill of all) {
    const lower = skill.toLowerCase().trim();

    // Department names
    if (BLOCKED_DEPARTMENT_NAMES.has(lower)) {
      warnings.push({ ruleId: "skills_taxonomy", ruleLabel: "R11: Skills Taxonomy", severity: "warning",
        message: `"${skill}" is a department name, not a skill` });
      continue;
    }
    // Soft skills
    if (BLOCKED_SOFT_SKILLS.has(lower)) {
      warnings.push({ ruleId: "skills_taxonomy", ruleLabel: "R11: Skills Taxonomy", severity: "warning",
        message: `"${skill}" is a soft skill — not verifiable in Skills section` });
      continue;
    }
    // Lifecycle claims
    if (BLOCKED_LIFECYCLE_CLAIMS.has(lower)) {
      warnings.push({ ruleId: "skills_taxonomy", ruleLabel: "R11: Skills Taxonomy", severity: "warning",
        message: `"${skill}" is a lifecycle claim, not a skill` });
      continue;
    }
    // Buzzword categories
    if (BLOCKED_BUZZWORD_CATEGORIES.has(lower)) {
      warnings.push({ ruleId: "skills_taxonomy", ruleLabel: "R11: Skills Taxonomy", severity: "warning",
        message: `"${skill}" is a market segment — domain belongs in bullets` });
      continue;
    }
    // Activity descriptions (without tool pairing)
    for (const activity of ACTIVITY_PATTERNS) {
      if (lower === activity) {
        warnings.push({ ruleId: "skills_taxonomy", ruleLabel: "R11: Skills Taxonomy", severity: "info",
          message: `"${skill}" is an activity — pair with tool or move to bullet` });
      }
    }
    // Domain claims (experience/expertise/domain)
    if (/\b(experience|expertise|domain)\b/i.test(lower) && lower.split(/\s+/).length > 1) {
      warnings.push({ ruleId: "skills_domain_claim", ruleLabel: "R5: Domain Claim", severity: "warning",
        message: `"${skill}" — skills should be tools, frameworks, or methodologies` });
    }
  }
  return dedupe(warnings);
}

// ── Rule 12: Skills-Experience Consistency ───────────────────────────────────

function checkSkillsEvidence(
  skills: { category: string; items: string[] }[],
  addedSkills: Map<string, string[]>,
  newSections: { name: string; list: string }[],
  bulletTexts: string[]
): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const all = allSkillTexts(skills, addedSkills, newSections);
  const bulletsLower = bulletTexts.map((b) => b.toLowerCase()).join(" ");

  for (const skill of all) {
    const lower = skill.toLowerCase().trim();
    if (lower.length < 2) continue;

    // Check if skill appears in any bullet (exact or close match)
    const variants = [lower, lower.replace(/-/g, " "), lower.replace(/\s/g, "-")];
    const found = variants.some((v) => bulletsLower.includes(v));

    if (!found) {
      warnings.push({ ruleId: "skills_evidence", ruleLabel: "R12: Skills Evidence", severity: "warning",
        message: `"${skill}" not found in any bullet — unanchored skill` });
    }
  }
  return dedupe(warnings);
}

// ── Rule 6: Bullet Variety ────────────────────────────────────────────────────

function checkBulletVariety(bulletTexts: string[]): RuleWarning[] {
  if (bulletTexts.length < 4) return [];
  const warnings: RuleWarning[] = [];

  // Duplicate lead verbs
  const verbCounts = new Map<string, number>();
  for (const text of bulletTexts) {
    const verb = leadVerb(text);
    verbCounts.set(verb, (verbCounts.get(verb) || 0) + 1);
  }
  for (const [verb, count] of verbCounts) {
    if (count > 1 && verb.length > 2) {
      warnings.push({ ruleId: "bullet_variety", ruleLabel: "R6: Bullet Variety", severity: "warning",
        message: `${count} bullets start with "${verb}" — vary lead verbs` });
    }
  }

  // Length variance
  const lengths = bulletTexts.map((t) => t.length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const stddev = Math.sqrt(lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length);
  if (stddev < 15) {
    warnings.push({ ruleId: "bullet_variety", ruleLabel: "R6: Bullet Variety", severity: "info",
      message: `Bullet lengths very uniform (stddev ${Math.round(stddev)}) — vary for readability` });
  }

  // All metrics same direction
  const up = bulletTexts.filter((t) => /\b(increased|grew|improved|boosted|raised|gained)\b/i.test(t)).length;
  const down = bulletTexts.filter((t) => /\b(reduced|cut|decreased|lowered|eliminated|saved)\b/i.test(t)).length;
  if (up + down >= 3 && (up === 0 || down === 0)) {
    warnings.push({ ruleId: "bullet_variety", ruleLabel: "R6: Bullet Variety", severity: "info",
      message: `All metrics point same direction — mix increases and reductions` });
  }

  return warnings;
}

// ── Rule 7: Metric Honesty ────────────────────────────────────────────────────

function checkMetricHonesty(bulletTexts: string[]): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const numberPattern = /\b(\d+)(%|\+|x|X)?\b/g;
  const allNumbers: number[] = [];

  for (const text of bulletTexts) {
    let match;
    while ((match = numberPattern.exec(text)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > 1 && num < 10000) allNumbers.push(num);
    }
  }

  if (allNumbers.length >= 3 && allNumbers.every((n) => n % 5 === 0)) {
    warnings.push({ ruleId: "metric_honesty", ruleLabel: "R7: Metric Honesty", severity: "info",
      message: `All ${allNumbers.length} metrics are round numbers — consider exact figures` });
  }
  return warnings;
}

// ── Rule 13: Requirement Coverage Scoring ───────────────────────────────────

function checkRequirementCoverage(
  jdRequiredQuals: string[],
  jdPreferredQuals: string[],
  bulletTexts: string[],
  summaryText: string,
  skillTexts: string[]
): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const bulletsLower = bulletTexts.map((b) => b.toLowerCase()).join(" ");
  const summaryLower = summaryText.toLowerCase();
  const skillsLower = skillTexts.map((s) => s.toLowerCase()).join(" ");

  function classifyQual(qualText: string): "strong" | "weak" | "missing" {
    const keywords = qualText.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3)
      .filter((w) => !new Set(["with", "that", "this", "from", "have", "been", "your", "will", "more", "years", "experience", "strong", "ability", "able"]).has(w));
    if (keywords.length === 0) return "strong"; // trivial qual

    const bulletHits = keywords.filter((w) => bulletsLower.includes(w)).length;
    const bulletRatio = bulletHits / keywords.length;

    if (bulletRatio >= 0.4) return "strong";

    const summaryHits = keywords.filter((w) => summaryLower.includes(w)).length;
    const skillsHits = keywords.filter((w) => skillsLower.includes(w)).length;
    if (summaryHits >= 2 || skillsHits >= 2) return "weak";

    return "missing";
  }

  // Required quals
  let missingRequired = 0;
  let weakRequired = 0;
  for (const qual of jdRequiredQuals) {
    const rating = classifyQual(qual);
    if (rating === "missing") {
      missingRequired++;
      warnings.push({ ruleId: "requirement_coverage", ruleLabel: "R13: Coverage", severity: "error",
        message: `Required qual MISSING from resume`, detail: qual.slice(0, 80) });
    } else if (rating === "weak") {
      weakRequired++;
      warnings.push({ ruleId: "requirement_coverage", ruleLabel: "R13: Coverage", severity: "warning",
        message: `Required qual WEAK — in summary/skills but no bullet evidence`, detail: qual.slice(0, 80) });
    }
  }

  if (missingRequired >= 2) {
    warnings.push({ ruleId: "requirement_coverage", ruleLabel: "R13: Coverage", severity: "error",
      message: `${missingRequired} required quals missing — likely 24hr rejection candidate` });
  }

  // Preferred quals (info only)
  for (const qual of jdPreferredQuals) {
    const rating = classifyQual(qual);
    if (rating === "missing") {
      warnings.push({ ruleId: "requirement_coverage", ruleLabel: "R13: Coverage", severity: "info",
        message: `Preferred qual missing`, detail: qual.slice(0, 80) });
    }
  }

  return warnings;
}

// ── Rule 14: Bullet Ordering ────────────────────────────────────────────────

function checkBulletOrdering(
  bulletTexts: string[],
  jdRequiredQuals: string[]
): RuleWarning[] {
  if (bulletTexts.length < 2 || jdRequiredQuals.length === 0) return [];
  const warnings: RuleWarning[] = [];

  // The first bullet should address the top JD theme
  const topQual = jdRequiredQuals[0].toLowerCase();
  const topKeywords = topQual.replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w) => !new Set(["with", "that", "this", "from", "have", "years", "experience", "strong", "ability"]).has(w));

  const firstBulletLower = bulletTexts[0].toLowerCase();
  const firstBulletHits = topKeywords.filter((w) => firstBulletLower.includes(w)).length;
  const firstBulletRatio = topKeywords.length > 0 ? firstBulletHits / topKeywords.length : 1;

  // Check if a later bullet is a better match for the top qual
  let bestIdx = 0;
  let bestRatio = firstBulletRatio;
  for (let i = 1; i < bulletTexts.length; i++) {
    const lower = bulletTexts[i].toLowerCase();
    const hits = topKeywords.filter((w) => lower.includes(w)).length;
    const ratio = topKeywords.length > 0 ? hits / topKeywords.length : 0;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = i;
    }
  }

  if (bestIdx > 0 && bestRatio - firstBulletRatio > 0.2) {
    warnings.push({ ruleId: "bullet_ordering", ruleLabel: "R14: Bullet Order", severity: "info",
      message: `Bullet #${bestIdx + 1} better matches top JD requirement than bullet #1 — consider reordering` });
  }

  return warnings;
}

// ── Rule 18: Honesty Anchors ────────────────────────────────────────────────

function checkHonestyAnchors(bulletTexts: string[]): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  let anchorCount = 0;

  for (const text of bulletTexts) {
    const lower = text.toLowerCase();

    // Tradeoffs: kill, cut, delay, constraint, pushed back, scope
    if (/\b(killed|cut|delayed|pushed back|descoped|dropped|removed|deprecated|retired)\b/i.test(text)) anchorCount++;

    // Failures / limits
    if (/\b(limitation|workaround|failed|late|behind|gap|constraint|tradeoff|trade-off)\b/i.test(text)) anchorCount++;

    // Approximation markers
    if (/[~≈]|roughly|estimated|approximately/i.test(text)) anchorCount++;

    // Specific named collaborators
    if (/\b(the\s+\w+\s+(lead|team|manager|director|engineer))\b/i.test(text)) anchorCount++;

    // Boring infra work
    if (/\b(cleanup|migration|reconciliation|taxonomy|audit|backfill|deprecat)\b/i.test(text)) anchorCount++;

    // Domain micro-details
    if (/\b(p\d{2}\s+latency|Reg\s+[A-Z]|BM25|HIPAA|SOC2|PCI)\b/i.test(text)) anchorCount++;
  }

  if (bulletTexts.length >= 6 && anchorCount < 4) {
    warnings.push({ ruleId: "honesty_anchors", ruleLabel: "R18: Honesty Anchors", severity: "warning",
      message: `Only ${anchorCount} honesty anchors found (min 4) — add tradeoffs, approximations, or specific details` });
  }

  return warnings;
}

// ── Headline Match ──────────────────────────────────────────────────────────

function checkHeadlineMatch(
  jdTitle: string,
  bulletSources: string[],
): RuleWarning[] {
  if (!jdTitle) return [];
  const warnings: RuleWarning[] = [];

  // Extract key role words from JD title
  const jdTitleWords = jdTitle.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2)
    .filter((w) => !new Set(["the", "and", "for", "with"]).has(w));

  // The most common role identifiers
  const roleTerms = ["product manager", "program manager", "project manager",
    "data analyst", "data scientist", "software engineer", "designer",
    "product designer", "ux researcher", "engineering manager"];

  const jdLower = jdTitle.toLowerCase();
  const matchedRole = roleTerms.find((r) => jdLower.includes(r));

  if (matchedRole) {
    // Check if any bullet source contains this role
    const sourcesLower = bulletSources.map((s) => s.toLowerCase()).join(" ");
    if (!sourcesLower.includes(matchedRole)) {
      warnings.push({ ruleId: "headline_match", ruleLabel: "Headline Match", severity: "error",
        message: `JD title is "${jdTitle}" but no experience matches "${matchedRole}"`,
        detail: `Recruiter searches "${matchedRole}" — add it to resume headline or most recent role` });
    }
  }

  return warnings;
}

// ── Poison Words ────────────────────────────────────────────────────────────

function checkPoisonWords(bulletSources: string[]): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const poisonWords = ["intern", "junior", "entry-level", "entry level", "trainee", "apprentice"];

  for (const source of bulletSources) {
    const lower = source.toLowerCase();
    for (const poison of poisonWords) {
      if (lower.includes(poison)) {
        warnings.push({ ruleId: "poison_words", ruleLabel: "Poison Words", severity: "warning",
          message: `"${poison}" in "${source}" — triggers NOT "${poison}" boolean filters`,
          detail: `Consider removing "${poison}" from the role title` });
      }
    }
  }
  return dedupe(warnings);
}

// ── Boolean Survival ────────────────────────────────────────────────────────

function checkBooleanSurvival(
  jdTitle: string,
  jdRequiredQuals: string[],
  bulletTexts: string[],
  summaryText: string,
  skillTexts: string[],
): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const allResume = [...bulletTexts, summaryText, ...skillTexts].join(" ").toLowerCase();

  // Extract the top boolean search terms a recruiter would use
  const booleanTerms = new Set<string>();

  // From title
  const titleWords = jdTitle.toLowerCase().replace(/[,|()]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  for (const w of titleWords) {
    if (!new Set(["the", "and", "for", "with", "senior", "staff", "lead", "principal"]).has(w)) {
      booleanTerms.add(w);
    }
  }

  // From top required quals: extract key nouns/tools
  const techPattern = /\b(SQL|Python|Java|Rust|TypeScript|React|AWS|GCP|Azure|Docker|Kubernetes|Agile|Scrum|JIRA|Figma|Tableau|Snowflake|Salesforce|B2B|SaaS|AI|ML|API|REST|GraphQL|ETL|CI\/CD|OKRs?)\b/gi;
  for (const qual of jdRequiredQuals.slice(0, 5)) {
    let m;
    while ((m = techPattern.exec(qual)) !== null) {
      booleanTerms.add(m[0].toLowerCase());
    }
  }

  // Check each boolean term
  for (const term of booleanTerms) {
    if (!allResume.includes(term)) {
      warnings.push({ ruleId: "boolean_survival", ruleLabel: "Boolean Survival", severity: "warning",
        message: `"${term}" not found in resume — invisible in recruiter boolean search`,
        detail: `JD uses "${term}" but resume doesn't contain it` });
    }
  }

  return warnings;
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

export interface ResumeRulesInput {
  bulletTexts: string[];
  bulletSources: string[]; // source labels for headline/poison checks
  summaryText: string;
  jdTitle: string;
  jdRequiredQuals: string[];
  jdPreferredQuals: string[];
  jdResponsibilities: string[];
  skills: { category: string; items: string[] }[];
  addedSkills: Map<string, string[]>;
  newSkillSections: { name: string; list: string }[];
}

export function validateResumeRules(input: ResumeRulesInput): RuleWarning[] {
  const allQuals = [...input.jdRequiredQuals, ...input.jdPreferredQuals];
  const skillList = allSkillTexts(input.skills, input.addedSkills, input.newSkillSections);

  return [
    ...checkHeadlineMatch(input.jdTitle, input.bulletSources),
    ...checkPoisonWords(input.bulletSources),
    ...checkBooleanSurvival(input.jdTitle, input.jdRequiredQuals, input.bulletTexts, input.summaryText, skillList),
    ...checkJdPhraseMirroring(input.bulletTexts, input.summaryText, allQuals, input.jdResponsibilities),
    ...checkBannedVocab(input.bulletTexts, input.summaryText),
    ...checkSummaryDiscipline(input.summaryText),
    ...checkSkillsTaxonomy(input.skills, input.addedSkills, input.newSkillSections),
    ...checkSkillsEvidence(input.skills, input.addedSkills, input.newSkillSections, input.bulletTexts),
    ...checkBulletVariety(input.bulletTexts),
    ...checkMetricHonesty(input.bulletTexts),
    ...checkRequirementCoverage(input.jdRequiredQuals, input.jdPreferredQuals, input.bulletTexts, input.summaryText, skillList),
    ...checkBulletOrdering(input.bulletTexts, input.jdRequiredQuals),
    ...checkHonestyAnchors(input.bulletTexts),
  ];
}

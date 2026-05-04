/**
 * Skills optimizer: picks the 3 most relevant skill categories for a job,
 * then fills each line with gap-filling keywords first + strongest remaining.
 *
 * Flow:
 * 1. Extract target keywords from JD (jd_skills + jd_ats_keywords)
 * 2. Scan selected bullets for keywords already covered
 * 3. Gap = JD keywords not in bullets
 * 4. Pick 3 categories from the pool of 6 that best cover the gap
 * 5. Within each category, prioritize gap-filling skills, then strongest remaining
 * 6. Respect 110-char per line ceiling
 */

const SKILL_LINE_MAX_CHARS = 110;

interface SkillCategory {
  header: string;
  skills: string[];
}

interface OptimizedSkills {
  lines: Array<{ name: string; list: string }>;
  gapFilled: string[];
  gapRemaining: string[];
}

/**
 * Extract all target keywords from a job's extracted JD data.
 */
function extractTargetKeywords(jdSkills: any, jdAtsKeywords: any): Set<string> {
  const targets = new Set<string>();

  if (jdSkills) {
    for (const category of ["technical", "tools", "languages", "methodologies", "domain_expertise"]) {
      const items = jdSkills[category];
      if (Array.isArray(items)) {
        for (const item of items) {
          const cleaned = item.trim().toLowerCase();
          if (cleaned.length > 1 && !isNoise(cleaned)) {
            targets.add(cleaned);
          }
        }
      }
    }
  }

  if (jdAtsKeywords) {
    for (const item of jdAtsKeywords.high_priority || []) {
      const cleaned = item.trim().toLowerCase();
      if (cleaned.length > 2 && !isNoise(cleaned)) {
        targets.add(cleaned);
      }
    }
    for (const item of jdAtsKeywords.medium_priority || []) {
      const cleaned = item.trim().toLowerCase();
      if (cleaned.length > 3 && !isNoise(cleaned)) {
        targets.add(cleaned);
      }
    }
  }

  return targets;
}

/**
 * Filter out HTML artifacts and non-skill terms from ATS keywords.
 */
function isNoise(term: string): boolean {
  return /^(\/?(div|li|ul|ol|h[1-6]|strong|span|p|class|style))$/i.test(term)
    || /^(the|and|for|with|that|this|from|have|been|most|like|also|your|will)$/i.test(term)
    || term.length <= 1;
}

/**
 * Find which target keywords are already present in the selected bullet texts.
 */
function findCoveredKeywords(bulletTexts: string[], targets: Set<string>): Set<string> {
  const covered = new Set<string>();
  const allText = bulletTexts.join(" ").toLowerCase();

  for (const target of targets) {
    if (allText.includes(target)) {
      covered.add(target);
    }
  }

  return covered;
}

/**
 * Check if a skill name and a gap term are a genuine match.
 * Requires the match to be a whole word or a substantial substring (>50% of either).
 */
function isGenuineMatch(skill: string, gapTerm: string): boolean {
  const s = skill.toLowerCase();
  const g = gapTerm.toLowerCase();

  // Exact match
  if (s === g) return true;

  // Whole-word match (gap term is a complete word in the skill name)
  const wordBoundary = new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (wordBoundary.test(s)) return true;

  // Substantial substring: gap term is >50% of the skill name length
  if (s.includes(g) && g.length >= s.length * 0.5) return true;
  if (g.includes(s) && s.length >= g.length * 0.5) return true;

  return false;
}

/**
 * Score a skill category by how many gap keywords its skills cover.
 */
function scoreCategory(category: SkillCategory, gap: Set<string>): number {
  let score = 0;
  for (const skill of category.skills) {
    for (const gapTerm of gap) {
      if (isGenuineMatch(skill, gapTerm)) {
        score++;
      }
    }
  }
  return score;
}

/**
 * Build a single skill line, prioritizing gap-filling skills.
 * Respects the character ceiling.
 */
function buildSkillLine(
  category: SkillCategory,
  gap: Set<string>,
  filledGaps: string[],
): string {
  const headerLen = category.header.length + 2; // "Header: "
  const maxListLen = SKILL_LINE_MAX_CHARS - headerLen;

  // Split skills into gap-fillers and others
  const gapFillers: string[] = [];
  const others: string[] = [];

  for (const skill of category.skills) {
    let isGapFiller = false;
    for (const gapTerm of gap) {
      if (isGenuineMatch(skill, gapTerm)) {
        isGapFiller = true;
        break;
      }
    }
    if (isGapFiller) {
      gapFillers.push(skill);
    } else {
      others.push(skill);
    }
  }

  // Build the list: gap fillers first, then others, respecting char limit
  const selected: string[] = [];
  let currentLen = 0;

  for (const skill of [...gapFillers, ...others]) {
    const addition = selected.length === 0 ? skill.length : skill.length + 2; // ", " separator
    if (currentLen + addition > maxListLen) break;
    selected.push(skill);
    currentLen += addition;

    // Track which gaps we filled
    for (const gapTerm of gap) {
      if (isGenuineMatch(skill, gapTerm)) {
        filledGaps.push(gapTerm);
      }
    }
  }

  return selected.join(", ");
}

/**
 * Main function: optimize 3 skill lines for a specific job.
 */
export function optimizeSkills(
  allCategories: SkillCategory[],
  bulletTexts: string[],
  jdSkills: any,
  jdAtsKeywords: any,
): OptimizedSkills {
  // Step 1: Extract target keywords from JD
  const targets = extractTargetKeywords(jdSkills, jdAtsKeywords);

  // Step 2: Find which are already covered by bullets
  const covered = findCoveredKeywords(bulletTexts, targets);

  // Step 3: Gap = targets not in bullets
  const gap = new Set<string>();
  for (const t of targets) {
    if (!covered.has(t)) gap.add(t);
  }

  // Step 4: Score each category by gap coverage + domain affinity, pick top 3
  const pool = allCategories.filter(
    (c) => c.header !== "Certifications" && c.header !== "Tools and Frameworks",
  );

  // Domain affinity: if JD mentions AI/ML terms, boost Data/ML category etc.
  const allTargetStr = [...targets].join(" ");
  const domainBoosts: Record<string, number> = {};
  if (/\b(ai|ml|machine learn|llm|inference|model|neural|deep learn|nlp)\b/i.test(allTargetStr)) {
    domainBoosts["Data, ML and Search"] = 3;
  }
  if (/\b(api|backend|system|architect|distribut|microservice|docker|kubernetes)\b/i.test(allTargetStr)) {
    domainBoosts["Backend and Systems"] = 2;
  }
  if (/\b(product|roadmap|stakeholder|strategy|prioritiz|prd|user research)\b/i.test(allTargetStr)) {
    domainBoosts["Product and Strategy"] = 2;
  }
  if (/\b(aws|cloud|lambda|s3|sagemaker|infrastructure)\b/i.test(allTargetStr)) {
    domainBoosts["AWS and Cloud"] = 2;
  }
  if (/\b(react|next\.?js|frontend|full.?stack|node|typescript|javascript)\b/i.test(allTargetStr)) {
    domainBoosts["Frontend and Full-Stack"] = 2;
  }

  const scored = pool.map((cat) => ({
    category: cat,
    score: scoreCategory(cat, gap) + (domainBoosts[cat.header] || 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  const top3 = scored.slice(0, 3).map((s) => s.category);

  // Step 5: Build lines with gap-filling priority
  const filledGaps: string[] = [];
  const lines = top3.map((cat) => ({
    name: cat.header,
    list: buildSkillLine(cat, gap, filledGaps),
  }));

  // Step 6: Report remaining gaps
  const filledSet = new Set(filledGaps);
  const remaining = [...gap].filter((g) => !filledSet.has(g));

  return { lines, gapFilled: filledGaps, gapRemaining: remaining };
}

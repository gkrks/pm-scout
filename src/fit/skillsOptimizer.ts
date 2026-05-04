/**
 * Skills optimizer: JD-first approach.
 *
 * 1. Extract EVERY skill/keyword the JD actually asks for
 * 2. For each JD skill, find if it exists in master resume skills
 * 3. Group matched skills into the resume's category headers
 * 4. Pick top 3 categories by number of JD-matched skills
 * 5. Within each category, show ONLY skills the JD asks for
 * 6. Respect 110-char per line ceiling
 *
 * Never include a skill the JD doesn't mention.
 */

const SKILL_LINE_MAX_CHARS = 110;

interface SkillCategory {
  header: string;
  skills: string[];
}

interface SkillLine {
  name: string;
  list: string;
  jdEvidence: string[]; // which JD terms this line covers
}

interface OptimizedSkills {
  lines: SkillLine[];
  gapFilled: string[];     // JD terms we have in resume
  gapRemaining: string[];  // JD terms we don't have
}

/**
 * Extract all meaningful skill terms from the JD.
 * Sources: jd_skills fields, required/preferred quals, ats_keywords.
 */
function extractJdSkillTerms(
  jdSkills: any,
  jdAtsKeywords: any,
  requiredQuals: string[],
  preferredQuals: string[],
): string[] {
  const terms = new Set<string>();

  // From structured jd_skills
  if (jdSkills) {
    for (const category of ["technical", "tools", "languages", "methodologies", "domain_expertise"]) {
      for (const item of jdSkills[category] || []) {
        const cleaned = item.trim();
        if (cleaned.length > 1 && !isNoise(cleaned)) {
          terms.add(cleaned);
        }
      }
    }
  }

  // From qualifications text — extract tool/tech mentions
  const allQuals = [...(requiredQuals || []), ...(preferredQuals || [])];
  const techPatterns = [
    /\b(AI|ML|LLM|NLP|API|SDK|REST|GraphQL|SQL|NoSQL)\b/gi,
    /\b(Python|Rust|TypeScript|JavaScript|Java|Go|C\+\+|Ruby)\b/g,
    /\b(React|Next\.?js|Node\.?js|Express|FastAPI|Flask|Django)\b/gi,
    /\b(AWS|GCP|Azure|Docker|Kubernetes|Terraform)\b/gi,
    /\b(TensorFlow|PyTorch|SageMaker|Hugging\s*Face)\b/gi,
    /\b(inference|embeddings?|fine.?tuning|agent\s*framework|RAG|vector\s*search)\b/gi,
    /\b(A\/B\s*test|experimentation|analytics|metrics|data\s*analysis)\b/gi,
    /\b(CI\/CD|DevOps|microservices|distributed\s*systems)\b/gi,
    /\b(Figma|JIRA|Postman|Git|Agile|Scrum)\b/gi,
    /\b(roadmap|PRD|user\s*research|stakeholder\s*management|OKR|prioritization)\b/gi,
    /\b(product\s*management|developer\s*tool|developer\s*experience)\b/gi,
  ];

  for (const qual of allQuals) {
    for (const pattern of techPatterns) {
      const matches = qual.match(pattern);
      if (matches) {
        for (const m of matches) {
          terms.add(m.trim());
        }
      }
    }
  }

  return [...terms];
}

/**
 * Filter out HTML artifacts and generic non-skill terms.
 */
function isNoise(term: string): boolean {
  const lower = term.toLowerCase();
  return /^(\/?(div|li|ul|ol|h[1-6]|strong|span|p|class|style))$/i.test(lower)
    || /^(the|and|for|with|that|this|from|have|been|most|like|also|your|will|teams?)$/i.test(lower)
    || lower.length <= 1;
}

/**
 * Check if a resume skill matches a JD term.
 */
function skillMatchesJdTerm(resumeSkill: string, jdTerm: string): boolean {
  const s = resumeSkill.toLowerCase();
  const j = jdTerm.toLowerCase();

  if (s === j) return true;

  // Whole-word match
  const wb = new RegExp(`\\b${j.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (wb.test(s)) return true;

  // Reverse: JD term contains the resume skill as a whole word
  const wb2 = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (wb2.test(j)) return true;

  return false;
}

/**
 * Main: optimize 3 skill lines based purely on what the JD asks for.
 */
export function optimizeSkills(
  allCategories: SkillCategory[],
  bulletTexts: string[],
  jdSkills: any,
  jdAtsKeywords: any,
  requiredQuals?: string[],
  preferredQuals?: string[],
  jdExtractedSkills?: string[],
): OptimizedSkills {
  // Step 1: Use LLM-extracted skills if available, else fall back to regex
  let jdTerms: string[];
  if (jdExtractedSkills && jdExtractedSkills.length > 0) {
    jdTerms = jdExtractedSkills;
  } else {
    jdTerms = extractJdSkillTerms(
      jdSkills, jdAtsKeywords,
      requiredQuals || [], preferredQuals || [],
    );
  }

  // Step 2: For each JD term, find matching resume skills
  const pool = allCategories.filter(
    (c) => c.header !== "Certifications",
  );

  // categoryName -> [{resumeSkill, jdTerm}]
  const categoryMatches = new Map<string, Array<{ resumeSkill: string; jdTerm: string }>>();
  const allMatched = new Set<string>(); // JD terms we found in resume

  for (const cat of pool) {
    const matches: Array<{ resumeSkill: string; jdTerm: string }> = [];
    for (const skill of cat.skills) {
      for (const jdTerm of jdTerms) {
        if (skillMatchesJdTerm(skill, jdTerm)) {
          matches.push({ resumeSkill: skill, jdTerm });
          allMatched.add(jdTerm.toLowerCase());
        }
      }
    }
    if (matches.length > 0) {
      categoryMatches.set(cat.header, matches);
    }
  }

  // Step 3: Rank categories by number of JD-matched skills
  const ranked = [...categoryMatches.entries()]
    .map(([header, matches]) => {
      const uniqueSkills = [...new Set(matches.map((m) => m.resumeSkill))];
      const jdEvidence = [...new Set(matches.map((m) => m.jdTerm))];
      return { header, skills: uniqueSkills, jdEvidence, count: uniqueSkills.length };
    })
    .sort((a, b) => b.count - a.count);

  // If fewer than 3 categories have JD matches, add the most relevant remaining categories
  if (ranked.length < 3) {
    const usedHeaders = new Set(ranked.map((r) => r.header));
    const remaining = pool
      .filter((c) => !usedHeaders.has(c.header))
      .sort((a, b) => b.skills.length - a.skills.length);
    for (const cat of remaining) {
      if (ranked.length >= 3) break;
      ranked.push({
        header: cat.header,
        skills: [],
        jdEvidence: [],
        count: 0,
      });
    }
  }

  // Step 4: Build lines — JD-matched skills first, then fill with related skills from same category
  // Minimum 4 skills per line, minimum 12 total
  const MIN_PER_LINE = 4;
  const lines: SkillLine[] = [];

  for (const cat of ranked.slice(0, 3)) {
    const fullCategory = pool.find((c) => c.header === cat.header);
    if (!fullCategory) continue;

    const headerLen = cat.header.length + 2;
    const maxListLen = SKILL_LINE_MAX_CHARS - headerLen;

    // Start with JD-matched skills, then add remaining from the category
    const jdMatchedSet = new Set(cat.skills.map((s) => s.toLowerCase()));
    const remainingSkills = fullCategory.skills.filter(
      (s) => !jdMatchedSet.has(s.toLowerCase()),
    );

    const selected: string[] = [];
    let currentLen = 0;

    // JD-matched first
    for (const skill of cat.skills) {
      const addition = selected.length === 0 ? skill.length : skill.length + 2;
      if (currentLen + addition > maxListLen) break;
      selected.push(skill);
      currentLen += addition;
    }

    // Fill with related skills until we have at least MIN_PER_LINE
    for (const skill of remainingSkills) {
      if (selected.length >= MIN_PER_LINE && currentLen > maxListLen * 0.7) break;
      const addition = selected.length === 0 ? skill.length : skill.length + 2;
      if (currentLen + addition > maxListLen) break;
      selected.push(skill);
      currentLen += addition;
    }

    lines.push({
      name: cat.header,
      list: selected.join(", "),
      jdEvidence: cat.jdEvidence,
    });
  }

  // Step 5: Report gaps
  const gapFilled = [...allMatched];
  const gapRemaining = jdTerms.filter(
    (t) => !allMatched.has(t.toLowerCase()),
  );

  return { lines, gapFilled, gapRemaining };
}

/**
 * Skills optimizer: JD-first, aggressive inclusion.
 *
 * Strategy:
 * 1. Start with ALL JD-extracted skills
 * 2. For each JD skill, check if it exists in resume OR if bullets prove it
 * 3. Include it. Period. If the JD asks for it and you have any evidence, add it.
 * 4. Group into 3 categories, fill to 110 chars per line, minimum 12 total
 * 5. If JD has < 12 skills, add the most relevant resume skills to fill
 */

const SKILL_LINE_MAX_CHARS = 110;

interface SkillCategory {
  header: string;
  skills: string[];
}

interface SkillLine {
  name: string;
  list: string;
  jdEvidence: string[];
}

interface OptimizedSkills {
  lines: SkillLine[];
  gapFilled: string[];
  gapRemaining: string[];
}

// Map JD skills to resume categories for grouping
const CATEGORY_MAP: Record<string, string[]> = {
  "Product and Strategy": [
    "product management", "product manager", "pm", "roadmap", "prd", "user research",
    "a/b testing", "prioritization", "stakeholder", "okr", "metric design", "gtm",
    "competitive analysis", "market analysis", "product strategy", "product vision",
    "usability studies", "user empathy", "customer discovery",
  ],
  "Data, ML and Search": [
    "sql", "data analysis", "analytics", "machine learning", "ml", "ai",
    "llm", "nlp", "inference", "embeddings", "tensorflow", "pytorch",
    "data science", "experimentation", "a/b test", "metrics", "dashboards",
    "information retrieval", "search", "bm25", "vector search",
  ],
  "Backend and Systems": [
    "api", "rest", "microservices", "distributed systems", "docker", "kubernetes",
    "ci/cd", "devops", "system architecture", "technical architecture",
    "backend", "infrastructure", "cloud", "aws", "scalable",
  ],
  "Frontend and Full-Stack": [
    "react", "next.js", "node.js", "typescript", "javascript", "html", "css",
    "frontend", "full-stack", "ui", "user interface", "wireframing", "mockups",
    "figma", "prototyping", "user interface design", "ux",
  ],
  "Languages": [
    "python", "rust", "java", "sql", "typescript", "javascript", "go", "c++",
  ],
  "AWS and Cloud": [
    "aws", "lambda", "dynamodb", "s3", "sagemaker", "cloudwatch", "gcp", "azure",
    "cloud", "infrastructure",
  ],
};

function findCategory(skill: string): string {
  const lower = skill.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw) || kw.includes(lower)) {
        return category;
      }
    }
  }
  return "Product and Strategy"; // default
}

/**
 * Extract JD skill terms from all available sources.
 */
function extractJdSkillTerms(
  jdSkills: any,
  jdAtsKeywords: any,
  requiredQuals: string[],
  preferredQuals: string[],
): string[] {
  const terms = new Set<string>();
  if (jdSkills) {
    for (const category of ["technical", "tools", "languages", "methodologies", "domain_expertise"]) {
      for (const item of jdSkills[category] || []) {
        const cleaned = item.trim();
        if (cleaned.length > 1 && !isNoise(cleaned)) terms.add(cleaned);
      }
    }
  }
  const allQuals = [...(requiredQuals || []), ...(preferredQuals || [])];
  const techPatterns = [
    /\b(AI|ML|LLM|NLP|API|SDK|REST|GraphQL|SQL|NoSQL)\b/gi,
    /\b(Python|Rust|TypeScript|JavaScript|Java|Go|C\+\+)\b/g,
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
      if (matches) for (const m of matches) terms.add(m.trim());
    }
  }
  return [...terms];
}

function isNoise(term: string): boolean {
  const lower = term.toLowerCase();
  return /^(\/?(div|li|ul|ol|h[1-6]|strong|span|p|class|style))$/i.test(lower)
    || /^(the|and|for|with|that|this|from|have|been|most|like|also|your|will|teams?)$/i.test(lower)
    || lower.length <= 1;
}

/**
 * Main optimizer: aggressive JD-skill inclusion.
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
  // Step 1: Get all JD skills
  let jdTerms: string[];
  if (jdExtractedSkills && jdExtractedSkills.length > 0) {
    jdTerms = jdExtractedSkills;
  } else {
    jdTerms = extractJdSkillTerms(
      jdSkills, jdAtsKeywords,
      requiredQuals || [], preferredQuals || [],
    );
  }

  // Step 2: ALL JD skills go in. Group them by category.
  const categorySkills = new Map<string, string[]>();
  const jdEvidence = new Map<string, string[]>();

  for (const term of jdTerms) {
    // Skip soft/generic terms
    if (/^(communication|leadership|empathy|curiosity|fast-moving|problem solving)$/i.test(term)) continue;

    const category = findCategory(term);
    if (!categorySkills.has(category)) categorySkills.set(category, []);
    if (!jdEvidence.has(category)) jdEvidence.set(category, []);

    // Check if this exact term or a close variant is in the resume
    const resumeSkill = findInResume(term, allCategories);
    if (resumeSkill) {
      // Use the resume's version (proper casing)
      if (!categorySkills.get(category)!.includes(resumeSkill)) {
        categorySkills.get(category)!.push(resumeSkill);
      }
    } else {
      // JD term not in resume, but add it anyway (the candidate claims it)
      if (!categorySkills.get(category)!.includes(term)) {
        categorySkills.get(category)!.push(term);
      }
    }
    jdEvidence.get(category)!.push(term);
  }

  // Step 3: If total skills < 12, fill from resume's existing categories
  const MIN_TOTAL = 12;
  let totalSkills = 0;
  for (const skills of categorySkills.values()) totalSkills += skills.length;

  if (totalSkills < MIN_TOTAL) {
    const usedSkills = new Set<string>();
    for (const skills of categorySkills.values()) {
      for (const s of skills) usedSkills.add(s.toLowerCase());
    }

    for (const cat of allCategories) {
      if (totalSkills >= MIN_TOTAL) break;
      const catName = cat.header;
      if (!categorySkills.has(catName)) categorySkills.set(catName, []);
      for (const skill of cat.skills) {
        if (totalSkills >= MIN_TOTAL) break;
        if (!usedSkills.has(skill.toLowerCase())) {
          categorySkills.get(catName)!.push(skill);
          usedSkills.add(skill.toLowerCase());
          totalSkills++;
        }
      }
    }
  }

  // Step 4: Rank categories by skill count, take top 3
  const ranked = [...categorySkills.entries()]
    .map(([header, skills]) => ({
      header,
      skills,
      evidence: jdEvidence.get(header) || [],
      count: skills.length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Step 5: Build lines respecting char limit
  const lines: SkillLine[] = [];
  for (const cat of ranked) {
    const headerLen = cat.header.length + 2;
    const maxListLen = SKILL_LINE_MAX_CHARS - headerLen;

    const selected: string[] = [];
    let currentLen = 0;
    for (const skill of cat.skills) {
      const addition = selected.length === 0 ? skill.length : skill.length + 2;
      if (currentLen + addition > maxListLen) break;
      selected.push(skill);
      currentLen += addition;
    }

    lines.push({
      name: cat.header,
      list: selected.join(", "),
      jdEvidence: cat.evidence,
    });
  }

  // Report
  const allIncluded = new Set<string>();
  for (const line of lines) {
    for (const s of line.list.split(", ")) allIncluded.add(s.toLowerCase());
  }
  const gapFilled = jdTerms.filter((t) => allIncluded.has(t.toLowerCase()));
  const gapRemaining = jdTerms.filter((t) => !allIncluded.has(t.toLowerCase()));

  return { lines, gapFilled, gapRemaining };
}

/**
 * Find a JD skill term in the resume's skill categories.
 * Returns the resume's version (proper casing) or null.
 */
function findInResume(jdTerm: string, categories: SkillCategory[]): string | null {
  const lower = jdTerm.toLowerCase();
  for (const cat of categories) {
    for (const skill of cat.skills) {
      const skillLower = skill.toLowerCase();
      if (skillLower === lower) return skill;
      if (skillLower.includes(lower) || lower.includes(skillLower)) return skill;
      // Word boundary match
      const wb = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (wb.test(skill)) return skill;
    }
  }
  return null;
}

/**
 * Skills optimizer: JD-driven categories + company tech stack.
 *
 * Strategy:
 * 1. Analyze JD quals + responsibilities to derive 3 skill sub-sections
 * 2. For each section, include only tools/tech/frameworks the company uses
 * 3. Cross-reference with candidate's actual skills from master_resume
 * 4. Only include skills the candidate can defend in an interview
 */

import fetch from "node-fetch";

const SKILL_LINE_MAX_CHARS = 110;
const MIN_TOTAL = 12;

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

// ── Blocked terms (Rule 11): not real skills ────────────────────────────────

const BLOCKED_TERMS = new Set([
  "communication", "leadership", "empathy", "curiosity", "fast-moving",
  "problem solving", "cross-functional", "stakeholder management",
  "collaboration", "teamwork", "adaptability", "time management",
  "saas", "b2b", "b2c", "enterprise", "startup",
  "devops", "it", "engineering", "sales ops", "customer success",
  "product management lifecycle", "end-to-end execution", "full sdlc",
]);

function isBlocked(term: string): boolean {
  return BLOCKED_TERMS.has(term.toLowerCase().trim());
}

// ── Extract concrete tools/tech from JD text ────────────────────────────────

function extractToolsFromText(texts: string[]): string[] {
  const combined = texts.join(" ");
  const tools = new Set<string>();

  const patterns = [
    // Languages
    /\b(Python|Rust|TypeScript|JavaScript|Java|Go|C\+\+|R|Scala|Ruby|Swift|Kotlin|SQL)\b/g,
    // Frameworks & libraries
    /\b(React|Next\.?js|Node\.?js|Express|FastAPI|Flask|Django|Spring|Rails|Vue|Angular)\b/gi,
    // Cloud & infra
    /\b(AWS|GCP|Azure|Docker|Kubernetes|Terraform|CloudFormation|Lambda|S3|DynamoDB|SQS|SNS|EC2|ECS|EKS)\b/g,
    // AI/ML
    /\b(TensorFlow|PyTorch|SageMaker|Hugging\s*Face|OpenAI|Vertex\s*AI|MLflow|Kubeflow|CUDA)\b/gi,
    // Data
    /\b(Snowflake|BigQuery|Redshift|Databricks|Spark|Kafka|Airflow|dbt|Looker|Tableau|Power\s*BI|Metabase)\b/gi,
    // Databases
    /\b(PostgreSQL|MySQL|MongoDB|Redis|Elasticsearch|DynamoDB|Cassandra|Neo4j|Supabase|Firebase)\b/gi,
    // Product & design tools
    /\b(Figma|JIRA|Confluence|Notion|Linear|Amplitude|Mixpanel|Segment|LaunchDarkly|Pendo|Heap|FullStory)\b/gi,
    // Methodologies
    /\b(Agile|Scrum|Kanban|OKRs?|RICE|JTBD|Design\s*Thinking|Lean)\b/gi,
    // Technical concepts
    /\b(REST\s*APIs?|GraphQL|gRPC|CI\/CD|ETL|RAG|LLM|NLP|embeddings?|vector\s*search|A\/B\s*test\w*|microservices)\b/gi,
    // Specific tools
    /\b(Git|GitHub|GitLab|Postman|Swagger|Datadog|Grafana|Splunk|PagerDuty|Sentry|New\s*Relic)\b/gi,
    // Security/compliance
    /\b(SOC\s*2|HIPAA|GDPR|PCI|FedRAMP|RBAC|SSO|OAuth|SAML)\b/gi,
  ];

  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(combined)) !== null) {
      const term = m[0].trim();
      if (!isBlocked(term)) tools.add(term);
    }
  }

  return Array.from(tools);
}

// ── LLM-based category derivation ───────────────────────────────────────────

async function deriveCategories(
  jdTitle: string,
  requiredQuals: string[],
  preferredQuals: string[],
  responsibilities: string[],
  jdTools: string[],
  candidateSkills: string[],
): Promise<{ name: string; skills: string[] }[] | null> {
  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) return null;

  const prompt = `You are organizing skills for a resume's Skills section targeting this role: "${jdTitle}".

JD Requirements: ${requiredQuals.slice(0, 6).join("; ")}
JD Responsibilities: ${responsibilities.slice(0, 5).join("; ")}
Tools/tech mentioned in JD: ${jdTools.join(", ")}
Candidate's skills: ${candidateSkills.join(", ")}

Create exactly 3 skill categories. Each category name must be 2-4 words derived from the JD's actual themes (NOT generic like "Technical Skills").

Rules:
- Only include tools, languages, frameworks, methodologies, or named systems
- Only include skills from the candidate's list OR tools explicitly in the JD that the candidate can claim
- NO soft skills, department names, market segments, or domain claims
- Each category should have 3-6 skills
- Category names should reflect what this specific role needs

Return JSON only:
{"categories": [{"name": "...", "skills": ["...", "..."]}, ...]}`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
      timeout: 15000,
    });

    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    if (parsed.categories && Array.isArray(parsed.categories)) {
      return parsed.categories.map((c: any) => ({
        name: c.name || "Other",
        skills: (c.skills || []).filter((s: string) => !isBlocked(s)),
      }));
    }
    return null;
  } catch {
    return null;
  }
}

// ── Deterministic fallback ──────────────────────────────────────────────────

function deriveCategoriesDeterministic(
  jdTools: string[],
  candidateSkills: string[],
): { name: string; skills: string[] }[] {
  // Group by type
  const languages: string[] = [];
  const platforms: string[] = [];
  const methods: string[] = [];
  const allSkills = new Set([...jdTools, ...candidateSkills].map((s) => s.toLowerCase()));

  const langSet = new Set(["python", "rust", "typescript", "javascript", "java", "go", "c++", "r", "scala", "sql", "ruby", "swift", "kotlin"]);
  const methodSet = new Set(["agile", "scrum", "kanban", "okrs", "rice", "jtbd", "a/b testing", "design thinking", "lean", "prd", "roadmapping", "user research"]);

  for (const skill of [...jdTools, ...candidateSkills]) {
    const lower = skill.toLowerCase();
    if (isBlocked(lower)) continue;
    if (langSet.has(lower)) { if (!languages.includes(skill)) languages.push(skill); }
    else if (methodSet.has(lower)) { if (!methods.includes(skill)) methods.push(skill); }
    else { if (!platforms.includes(skill)) platforms.push(skill); }
  }

  return [
    { name: "Tools and Platforms", skills: platforms.slice(0, 6) },
    { name: "Languages", skills: languages.slice(0, 5) },
    { name: "Methodologies", skills: methods.slice(0, 5) },
  ].filter((c) => c.skills.length > 0);
}

// ── Main optimizer ──────────────────────────────────────────────────────────

export async function optimizeSkills(
  allCategories: SkillCategory[],
  bulletTexts: string[],
  jdSkills: any,
  jdAtsKeywords: any,
  requiredQuals?: string[],
  preferredQuals?: string[],
  jdExtractedSkills?: string[],
  jdTitle?: string,
  responsibilities?: string[],
): Promise<OptimizedSkills> {
  // Step 1: Extract tools/tech from JD text
  const allJdText = [
    ...(requiredQuals || []),
    ...(preferredQuals || []),
    ...(responsibilities || []),
  ];
  const jdTools = extractToolsFromText(allJdText);

  // Also include explicitly extracted skills
  if (jdExtractedSkills) {
    for (const s of jdExtractedSkills) {
      if (!isBlocked(s) && !jdTools.some((t) => t.toLowerCase() === s.toLowerCase())) {
        jdTools.push(s);
      }
    }
  }
  if (jdSkills) {
    for (const category of ["technical", "tools", "languages", "methodologies"]) {
      for (const item of jdSkills[category] || []) {
        const cleaned = item.trim();
        if (cleaned.length > 1 && !isBlocked(cleaned) && !jdTools.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
          jdTools.push(cleaned);
        }
      }
    }
  }

  // Step 2: Get candidate's existing skills
  const candidateSkills: string[] = [];
  for (const cat of allCategories) {
    for (const skill of cat.skills) {
      if (!isBlocked(skill)) candidateSkills.push(skill);
    }
  }

  // Step 3: Derive 3 categories from JD (LLM with deterministic fallback)
  let categories = await deriveCategories(
    jdTitle || "",
    requiredQuals || [],
    preferredQuals || [],
    responsibilities || [],
    jdTools,
    candidateSkills,
  );

  if (!categories || categories.length === 0) {
    categories = deriveCategoriesDeterministic(jdTools, candidateSkills);
  }

  // Step 4: Build lines respecting char limit
  const lines: SkillLine[] = [];
  const allIncluded = new Set<string>();

  for (const cat of categories.slice(0, 3)) {
    const headerLen = cat.name.length + 2;
    const maxListLen = SKILL_LINE_MAX_CHARS - headerLen;

    const selected: string[] = [];
    let currentLen = 0;
    for (const skill of cat.skills) {
      if (isBlocked(skill)) continue;
      const addition = selected.length === 0 ? skill.length : skill.length + 2;
      if (currentLen + addition > maxListLen) break;
      selected.push(skill);
      currentLen += addition;
      allIncluded.add(skill.toLowerCase());
    }

    if (selected.length > 0) {
      lines.push({
        name: cat.name,
        list: selected.join(", "),
        jdEvidence: jdTools.filter((t) => selected.some((s) => s.toLowerCase() === t.toLowerCase())),
      });
    }
  }

  // Step 5: If under minimum, fill from candidate skills
  let totalSkills = 0;
  for (const line of lines) totalSkills += line.list.split(", ").length;

  if (totalSkills < MIN_TOTAL && lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    const headerLen = lastLine.name.length + 2;
    let currentLen = lastLine.list.length;

    for (const skill of candidateSkills) {
      if (totalSkills >= MIN_TOTAL) break;
      if (allIncluded.has(skill.toLowerCase())) continue;
      const addition = currentLen === 0 ? skill.length : skill.length + 2;
      if (headerLen + currentLen + addition > SKILL_LINE_MAX_CHARS) break;
      lastLine.list += (lastLine.list ? ", " : "") + skill;
      currentLen += addition;
      allIncluded.add(skill.toLowerCase());
      totalSkills++;
    }
  }

  // Report gaps
  const gapFilled = jdTools.filter((t) => allIncluded.has(t.toLowerCase()));
  const gapRemaining = jdTools.filter((t) => !allIncluded.has(t.toLowerCase()));

  return { lines, gapFilled, gapRemaining };
}

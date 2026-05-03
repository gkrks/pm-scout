/**
 * Known skill keywords for deterministic extraction.
 * Each list is matched case-insensitively against job description text.
 * Word-boundary matching is used to avoid false positives.
 */

export const TECHNICAL_SKILLS = [
  "SQL", "Python", "R", "Java", "JavaScript", "TypeScript", "Go", "Rust",
  "C\\+\\+", "C#", "Ruby", "PHP", "Swift", "Kotlin", "Scala",
  "HTML", "CSS", "React", "Angular", "Vue",
  "machine learning", "deep learning", "NLP", "natural language processing",
  "computer vision", "neural networks",
  "A/B testing", "experimentation", "statistical analysis",
  "data analysis", "data modeling", "data engineering", "data pipelines",
  "ETL", "data warehousing", "data visualization",
  "API design", "REST", "GraphQL", "gRPC", "microservices",
  "cloud computing", "distributed systems", "system design",
  "CI/CD", "DevOps", "infrastructure",
  "mobile development", "iOS", "Android",
  "information retrieval", "search", "ranking",
  "security", "encryption", "authentication",
];

export const TOOLS = [
  "Jira", "Confluence", "Asana", "Trello", "Linear", "Notion", "Monday",
  "Figma", "Sketch", "InVision", "Miro", "Whimsical",
  "Amplitude", "Mixpanel", "Google Analytics", "Segment", "Heap",
  "Metabase", "Looker", "Tableau", "Power BI", "Mode",
  "Salesforce", "HubSpot", "Zendesk", "Intercom",
  "Slack", "Teams",
  "Git", "GitHub", "GitLab", "Bitbucket",
  "AWS", "GCP", "Azure", "Snowflake", "BigQuery", "Redshift",
  "Databricks", "Airflow", "dbt",
  "Docker", "Kubernetes",
  "Postman", "Swagger",
  "LaunchDarkly", "Optimizely", "Split",
  "Pendo", "FullStory", "Hotjar",
  "Airtable", "Coda",
];

export const METHODOLOGIES = [
  "Agile", "Scrum", "Kanban", "Lean", "SAFe",
  "OKRs", "KPIs",
  "Design thinking", "design sprint",
  "user research", "usability testing", "user interviews",
  "product discovery", "product-led growth", "PLG",
  "jobs to be done", "JTBD",
  "growth hacking", "growth loops",
  "sprint planning", "backlog grooming", "retrospective",
  "continuous discovery",
  "six sigma",
  "waterfall",
];

export const SOFT_SKILLS = [
  "communication", "written communication", "verbal communication",
  "stakeholder management", "cross-functional",
  "leadership", "mentoring", "coaching",
  "problem solving", "critical thinking", "analytical thinking",
  "strategic thinking", "systems thinking",
  "collaboration", "teamwork",
  "presentation", "storytelling",
  "negotiation", "influence",
  "prioritization", "time management",
  "attention to detail",
  "adaptability", "resilience",
  "empathy", "emotional intelligence",
  "conflict resolution",
];

export const DOMAIN_EXPERTISE = [
  "fintech", "payments", "banking", "lending", "insurance",
  "e-commerce", "marketplace", "retail",
  "healthcare", "healthtech", "biotech", "pharma",
  "edtech", "education",
  "adtech", "advertising", "marketing",
  "cybersecurity", "infosec",
  "logistics", "supply chain",
  "real estate", "proptech",
  "gaming", "entertainment", "media", "streaming",
  "social media", "social networking",
  "developer tools", "devtools", "infrastructure",
  "enterprise", "SaaS", "B2B", "B2C",
  "AI", "ML", "artificial intelligence",
  "blockchain", "crypto", "web3",
  "IoT", "robotics", "autonomous",
  "climate", "cleantech", "sustainability",
];

export const CERTIFICATIONS = [
  "PMP", "CAPM",
  "CSPO", "CSM", "PSM",
  "AWS certified", "Azure certified", "GCP certified",
  "Six Sigma", "Lean Six Sigma",
  "ITIL",
  "PMI-ACP",
  "SAFe Agilist", "SAFe",
];

/**
 * Match skills from a text against a keyword list.
 * Uses word-boundary matching to avoid partial matches.
 */
export function matchSkills(text: string, keywords: string[]): string[] {
  const matched: string[] = [];
  for (const kw of keywords) {
    try {
      const re = new RegExp(`\\b${kw}\\b`, "i");
      if (re.test(text)) {
        // Use the canonical form from the list, not the matched text
        matched.push(kw.replace(/\\\+/g, "+"));
      }
    } catch {
      // Skip invalid regex patterns
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        matched.push(kw);
      }
    }
  }
  return [...new Set(matched)];
}

/**
 * Deterministic heading → canonical bucket classification.
 * Case-insensitive substring matching against known aliases.
 */

export type HeadingBucket =
  | "required_qualifications"
  | "preferred_qualifications"
  | "responsibilities"
  | "role_summary"
  | "team_info"
  | "company_info"
  | "benefits"
  | "compensation"
  | "application"
  | "legal"
  | "unknown";

// Order matters: more specific aliases must come before generic ones.
// E.g. "preferred qualifications" must match before "qualifications".
const HEADING_ALIASES: Array<{ bucket: HeadingBucket; aliases: string[] }> = [
  {
    bucket: "preferred_qualifications",
    aliases: [
      "preferred qualifications",
      "preferred skills",
      "nice to have",
      "nice-to-have",
      "bonus points",
      "bonus qualifications",
      "pluses",
      "even better",
      "what would set you apart",
      "also great",
      "it's a plus",
      "additional qualifications",
      "desired qualifications",
      "desired skills",
    ],
  },
  {
    bucket: "required_qualifications",
    aliases: [
      "basic qualifications",
      "minimum qualifications",
      "required qualifications",
      "required skills",
      "requirements",
      "what you'll need",
      "what you will need",
      "what we expect",
      "must have",
      "who you are",
      "about you",
      "you have",
      "what you bring",
      "you bring",
      "ideal candidate",
      "qualifications",
      "experience & qualifications",
      "skills & qualifications",
      "knowledge, skills",
      "what we look for",
      "what we like to see",
    ],
  },
  {
    bucket: "responsibilities",
    aliases: [
      "responsibilities",
      "what you'll do",
      "what you will do",
      "key responsibilities",
      "day-to-day",
      "your role",
      "in this role",
      "the opportunity",
      "your impact",
      "how you'll make an impact",
      "job duties",
      "the job",
      "about the job",
      "what you'll accomplish",
      "what you'll work on",
      "role responsibilities",
    ],
  },
  {
    bucket: "role_summary",
    aliases: [
      "role summary",
      "position overview",
      "about the role",
      "about this role",
      "about this position",
      "job summary",
      "overview",
      "the role",
      "role description",
      "position summary",
    ],
  },
  {
    bucket: "team_info",
    aliases: [
      "about the team",
      "about this team",
      "the team",
      "meet the team",
      "our team",
      "team overview",
    ],
  },
  {
    bucket: "company_info",
    aliases: [
      "about us",
      "about the company",
      "who we are",
      "our story",
      "company overview",
      "our mission",
      "why we exist",
      "our purpose",
    ],
  },
  {
    bucket: "benefits",
    aliases: [
      "benefits",
      "perks",
      "what we offer",
      "why join us",
      "our benefits",
      "perks & benefits",
      "benefits & perks",
      "total rewards",
    ],
  },
  {
    bucket: "compensation",
    aliases: [
      "compensation",
      "pay range",
      "salary range",
      "pay transparency",
      "total compensation",
      "salary",
      "compensation range",
    ],
  },
  {
    bucket: "application",
    aliases: [
      "interview process",
      "hiring process",
      "what to expect",
      "our process",
      "how to apply",
      "application process",
      "next steps",
    ],
  },
  {
    bucket: "legal",
    aliases: [
      "equal opportunity",
      "eeo statement",
      "diversity statement",
      "equal employment",
      "we are an equal opportunity",
      "accommodation",
    ],
  },
];

/**
 * Classify a heading into a canonical bucket using deterministic substring matching.
 * Returns "unknown" if no alias matches.
 */
export function classifyHeading(heading: string): HeadingBucket {
  const lower = heading.toLowerCase().trim();
  if (!lower) return "unknown";

  for (const { bucket, aliases } of HEADING_ALIASES) {
    for (const alias of aliases) {
      if (lower.includes(alias)) {
        return bucket;
      }
    }
  }

  return "unknown";
}

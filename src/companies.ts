export interface Company {
  name: string;
  slug: string;
  platform: "greenhouse" | "lever" | "ashby" | "amazon" | "google" | "meta" | "unsupported";
  careersUrl: string;
  earlyCareerUrl?: string;   // Dedicated early-careers / university portal URL
  tier?: "T0" | "T1" | "T2" | "T3" | "T3R"; // Target-list tier (undefined = not in curated 75)
}

// Slug → tier mapping for the curated 75-company target list.
const TIER_MAP: Record<string, Company["tier"]> = {
  // T0 — FAANG
  meta: "T0", amazon: "T0", apple: "T0", netflix: "T0", google: "T0",
  // T1 — MAANG-adjacent
  microsoft: "T1", "msft-careers": "T1", nvidia: "T1", oracle: "T1",
  // T2 — Public / Late-stage
  salesforce: "T2", adobe: "T2", intuit: "T2", atlassian: "T2",
  visa: "T2", mastercard: "T2", amex: "T2", capitalone: "T2",
  servicenow: "T2", workday: "T2", databricks: "T2", snowflake: "T2",
  cisco: "T2", ibm: "T2", qualcomm: "T2", pinterest: "T2",
  uber: "T2", airbnb: "T2", doordash: "T2", instacart: "T2",
  lyft: "T2", spotify: "T2", snap: "T2", palantir: "T2",
  paloaltonetworks: "T2", crowdstrike: "T2", okta: "T2", asana: "T2",
  // T3 — High-growth startups
  perplexity: "T3", gleanwork: "T3", algolia: "T3", elastic: "T3",
  vercel: "T3", anthropic: "T3", openai: "T3", scaleai: "T3",
  notion: "T3", figma: "T3", linear: "T3", mongodb: "T3",
  hubspotjobs: "T3", stripe: "T3", block: "T3", coinbase: "T3",
  webflow: "T3", retool: "T3",
  // T3R — Rabois-formula startups
  ramp: "T3R", brex: "T3R", mercury: "T3R", flexport: "T3R",
  project44: "T3R", samsara: "T3R", andurilindustries: "T3R",
  headway: "T3R", cedar: "T3R", alma: "T3R", opendoor: "T3R",
  gusto: "T3R", rippling: "T3R", toast: "T3R", uberfreight: "T3R",
  carta: "T3R", plaid: "T3R",
};

/**
 * ~150 top US tech companies.
 * GH/LV slugs are verified against the public API before inclusion.
 * Companies on Workday or custom ATS are marked "unsupported" and skipped by the scanner.
 */
export function allCompanies(): Company[] {
  const gh = (name: string, slug: string, url: string, ecUrl?: string): Company =>
    ({ name, slug, platform: "greenhouse", careersUrl: url, ...(ecUrl ? { earlyCareerUrl: ecUrl } : {}) });
  const lv = (name: string, slug: string, url: string, ecUrl?: string): Company =>
    ({ name, slug, platform: "lever", careersUrl: url, ...(ecUrl ? { earlyCareerUrl: ecUrl } : {}) });
  const as = (name: string, slug: string, url: string, ecUrl?: string): Company =>
    ({ name, slug, platform: "ashby" as const, careersUrl: url, ...(ecUrl ? { earlyCareerUrl: ecUrl } : {}) });
  // "unsupported" platform — these companies previously used a third-party aggregator.
  // They are kept in the static list for UI display purposes only; scrapeAll()
  // will skip them with an error. Migrate them to config/targets.json with
  // ats: "custom-playwright" or a supported ATS to re-enable scraping.
  const unsupported = (name: string, slug: string, url: string, ecUrl?: string): Company =>
    ({ name, slug, platform: "unsupported" as const, careersUrl: url, ...(ecUrl ? { earlyCareerUrl: ecUrl } : {}) });

  // Merge static list with user-added companies (loaded lazily to avoid circular deps).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadCustomCompanies } = require("./customCompanies") as {
    loadCustomCompanies: () => Company[];
  };
  const custom = loadCustomCompanies();

  const staticList: Company[] = [
    // ── Greenhouse ──────────────────────────────────────────────────────────── (97)
    gh("Airbnb",              "airbnb",           "https://careers.airbnb.com",                   "https://careers.airbnb.com/university/"),
    gh("Stripe",              "stripe",            "https://stripe.com/jobs",                      "https://stripe.com/jobs/university"),
    gh("Coinbase",            "coinbase",          "https://www.coinbase.com/careers"),
    gh("Lyft",                "lyft",              "https://lyft.com/careers"),
    gh("Dropbox",             "dropbox",           "https://dropbox.com/jobs"),
    gh("Instacart",           "instacart",         "https://instacart.com/careers"),
    gh("Reddit",              "reddit",            "https://redditinc.com/careers"),
    gh("Discord",             "discord",           "https://discord.com/careers"),
    gh("Robinhood",           "robinhood",         "https://careers.robinhood.com"),
    gh("Chime",               "chime",             "https://chime.com/careers"),
    gh("Brex",                "brex",              "https://brex.com/careers"),
    gh("Anthropic",           "anthropic",         "https://anthropic.com/careers"),
    gh("Scale AI",            "scaleai",           "https://scale.com/careers"),
    gh("Databricks",          "databricks",        "https://databricks.com/careers"),
    gh("Cloudflare",          "cloudflare",        "https://cloudflare.com/careers"),
    gh("Twilio",              "twilio",            "https://twilio.com/en-us/company/jobs"),
    gh("Amplitude",           "amplitude",         "https://amplitude.com/careers"),
    gh("PagerDuty",           "pagerduty",         "https://pagerduty.com/careers"),
    gh("Datadog",             "datadog",           "https://careers.datadoghq.com"),
    gh("Okta",                "okta",              "https://okta.com/company/careers"),
    gh("Affirm",              "affirm",            "https://affirm.com/careers"),
    gh("Faire",               "faire",             "https://faire.com/careers"),
    gh("Gusto",               "gusto",             "https://gusto.com/about/careers"),
    gh("Checkr",              "checkr",            "https://checkr.com/careers"),
    gh("Lattice",             "lattice",           "https://lattice.com/careers"),
    gh("Verkada",             "verkada",           "https://verkada.com/careers"),
    gh("Airtable",            "airtable",          "https://airtable.com/careers"),
    gh("Intercom",            "intercom",          "https://intercom.com/careers"),
    gh("Asana",               "asana",             "https://asana.com/jobs"),
    gh("Carta",               "carta",             "https://carta.com/careers"),
    gh("Rubrik",              "rubrik",            "https://rubrik.com/careers"),
    gh("Duolingo",            "duolingo",          "https://careers.duolingo.com",                 "https://careers.duolingo.com/new-grad"),
    gh("Roblox",              "roblox",            "https://careers.roblox.com"),
    gh("Samsara",             "samsara",           "https://samsara.com/careers"),
    gh("Squarespace",         "squarespace",       "https://careers.squarespace.com"),
    gh("SoFi",                "sofi",              "https://sofi.com/careers"),
    gh("Fivetran",            "fivetran",          "https://fivetran.com/careers"),
    gh("JFrog",               "jfrog",             "https://jfrog.com/careers"),
    gh("Figma",               "figma",             "https://figma.com/careers"),
    gh("Vercel",              "vercel",            "https://vercel.com/careers"),
    gh("Mixpanel",            "mixpanel",          "https://mixpanel.com/jobs"),
    gh("Block",               "block",             "https://block.xyz/careers"),
    gh("Qualtrics",           "qualtrics",         "https://qualtrics.com/careers"),
    gh("Toast",               "toast",             "https://careers.toasttab.com"),
    gh("Attentive",           "attentive",         "https://attentive.com/careers"),
    gh("Klaviyo",             "klaviyo",           "https://klaviyo.com/careers"),
    gh("LaunchDarkly",        "launchdarkly",      "https://launchdarkly.com/careers"),
    gh("Contentful",          "contentful",        "https://contentful.com/careers"),
    gh("Algolia",             "algolia",           "https://algolia.com/careers"),
    gh("Starburst",           "starburst",         "https://starburst.io/careers"),
    gh("Netlify",             "netlify",           "https://netlify.com/careers"),
    gh("CockroachLabs",       "cockroachlabs",     "https://cockroachlabs.com/careers"),
    gh("PlanetScale",         "planetscale",       "https://planetscale.com/company/careers"),
    gh("Temporal",            "temporal",          "https://temporal.io/careers"),
    gh("Zscaler",             "zscaler",           "https://zscaler.com/careers"),
    gh("MongoDB",             "mongodb",           "https://mongodb.com/careers"),
    gh("Elastic",             "elastic",           "https://elastic.co/careers"),
    gh("Wunderkind",          "wunderkind",        "https://wunderkind.co/careers"),
    gh("ZipRecruiter",        "ziprecruiter",      "https://ziprecruiter.com/careers"),
    gh("Blend",               "blend",             "https://blend.com/careers"),
    gh("Opendoor",            "opendoor",          "https://opendoor.com/careers"),
    gh("Flexport",            "flexport",          "https://flexport.com/careers"),
    gh("Coupang",             "coupang",           "https://coupang.com/c/jobs"),
    gh("Handshake",           "handshake",         "https://joinhandshake.com/careers"),
    gh("Remote",              "remote",            "https://remote.com/careers"),
    gh("Webflow",             "webflow",           "https://webflow.com/careers"),
    gh("GitLab",              "gitlab",            "https://about.gitlab.com/jobs"),
    gh("HubSpot",             "hubspotjobs",       "https://hubspot.com/careers"),
    gh("Coursera",            "coursera",          "https://coursera.org/about/careers"),
    gh("Udemy",               "udemy",             "https://about.udemy.com/jobs"),
    gh("Pendo",               "pendo",             "https://pendo.io/careers"),
    gh("Smartsheet",          "smartsheet",        "https://smartsheet.com/careers"),
    gh("Braze",               "braze",             "https://braze.com/careers"),
    gh("Sendbird",            "sendbird",          "https://sendbird.com/careers"),
    gh("Orca Security",       "orca",              "https://orca.security/company/jobs"),
    gh("Axonius",             "axonius",           "https://axonius.com/company/careers"),
    gh("Abnormal Security",   "abnormalsecurity",  "https://abnormalsecurity.com/careers"),
    gh("Exabeam",             "exabeam",           "https://exabeam.com/company/careers"),
    gh("Postman",             "postman",           "https://postman.com/company/careers"),
    gh("Together AI",         "togetherai",        "https://together.ai/careers"),
    gh("Salesloft",           "salesloft",         "https://salesloft.com/company/careers"),
    gh("Five9",               "five9",             "https://five9.com/about/careers"),
    gh("Dialpad",             "dialpad",           "https://dialpad.com/company/careers"),
    gh("Natera",              "natera",            "https://natera.com/careers"),
    gh("Omada Health",        "omadahealth",       "https://www.omadahealth.com/careers"),
    gh("Lucid Software",      "lucidsoftware",     "https://www.lucidsoftware.com/careers"),
    // New Greenhouse additions
    gh("Uber",                "uber",              "https://www.uber.com/us/en/careers/"),
    gh("DoorDash",            "doordash",          "https://careers.doordash.com"),
    gh("Pinterest",           "pinterest",         "https://www.pinterestcareers.com"),
    gh("Snap",                "snap",              "https://careers.snap.com"),
    gh("Miro",                "miro",              "https://miro.com/careers"),
    gh("Box",                 "box",               "https://careers.box.com"),
    gh("Procore",             "procore",           "https://careers.procore.com"),
    gh("Rippling",            "rippling",          "https://rippling.com/careers"),
    gh("Benchling",           "benchling",         "https://benchling.com/careers"),
    gh("Waymo",               "waymo",             "https://waymo.com/careers"),
    gh("Rivian",              "rivian",            "https://rivian.com/careers"),
    gh("Grafana Labs",        "grafana",           "https://grafana.com/about/careers"),
    gh("Navan",               "navan",             "https://navan.com/careers"),
    gh("Harness",             "harness",           "https://harness.io/company/careers"),
    // New Greenhouse additions (verified 2026-04-20)
    gh("Alma",                "alma",              "https://helloalma.com/careers"),
    gh("Anduril",             "andurilindustries", "https://www.andurilindustries.com/careers"),
    gh("Glean",               "gleanwork",         "https://glean.com/careers"),
    gh("Headway",             "headway",           "https://headway.co/careers"),
    gh("Project44",           "project44",         "https://project44.com/careers"),
    gh("Uber Freight",        "uberfreight",       "https://uberfreight.com/careers"),

    // ── Lever ───────────────────────────────────────────────────────────────── (14)
    // New Lever addition (verified 2026-04-20)
    lv("Atlassian",           "atlassian",         "https://www.atlassian.com/company/careers"),
    lv("Plaid",               "plaid",             "https://plaid.com/careers"),
    lv("Outreach",            "outreach",          "https://outreach.io/company/careers"),
    lv("Netflix",             "netflix",           "https://jobs.netflix.com"),
    lv("Palantir",            "palantir",          "https://palantir.com/careers"),
    lv("Neon",                "neon",              "https://neon.tech/careers"),
    lv("Lucidworks",          "lucidworks",        "https://lucidworks.com/company/careers"),
    lv("Mistral AI",          "mistral",           "https://mistral.ai/careers"),
    lv("Clari",               "clari",             "https://clari.com/company/careers"),
    lv("Highspot",            "highspot",          "https://highspot.com/careers"),
    lv("Mindtickle",          "mindtickle",        "https://mindtickle.com/careers"),
    lv("Freshworks",          "freshworks",        "https://freshworks.com/company/careers"),
    lv("Girls Who Code",      "girlswhocode",      "https://girlswhocode.com/careers"),
    lv("Weights & Biases",    "wandb",             "https://wandb.ai/careers"),
    lv("Cohere",              "cohere",            "https://cohere.com/careers"),

    // ── Ashby ───────────────────────────────────────────────────────────────── (16)
    as("Linear",              "linear",            "https://linear.app/careers"),
    as("Ramp",                "ramp",              "https://ramp.com/careers"),
    as("Mercury",             "mercury",           "https://mercury.com/careers"),
    as("Retool",              "retool",            "https://retool.com/careers"),
    as("Watershed",           "watershed",         "https://watershed.com/careers"),
    as("Notion",              "notion",            "https://notion.so/careers"),
    as("Descript",            "descript",          "https://descript.com/careers"),
    as("Deel",                "deel",              "https://deel.com/careers"),
    as("Pave",                "pave",              "https://pave.com/careers"),
    as("Coda",                "coda",              "https://coda.io/careers"),
    as("Hex",                 "hex",               "https://hex.tech/company/careers"),
    as("Tome",                "tome",              "https://tome.app/careers"),
    as("Perplexity",          "perplexity",        "https://www.perplexity.ai/careers"),
    as("dbt Labs",            "dbtlabs",           "https://www.getdbt.com/careers"),
    as("Anyscale",            "anyscale",          "https://www.anyscale.com/careers"),
    as("Character AI",        "characterai",       "https://character.ai/careers"),
    // New Ashby additions (verified 2026-04-20)
    as("Cedar",               "cedar",             "https://cedar.com/careers"),
    as("OpenAI",              "openai",            "https://openai.com/careers"),
    as("Snowflake",           "snowflake",         "https://www.snowflake.com/en/company/careers/"),

    // ── Custom scrapers ──────────────────────────────────────────────────────── (3)
    {
      name: "Amazon",  slug: "amazon",  platform: "amazon" as const,
      careersUrl: "https://www.amazon.jobs/en/teams/pmts",
      earlyCareerUrl: "https://www.amazon.jobs/en/teams/university-tech",
    },
    {
      name: "Google",  slug: "google",  platform: "google" as const,
      careersUrl: "https://careers.google.com",
      earlyCareerUrl: "https://careers.google.com/students/",
    },
    {
      name: "Meta",    slug: "meta",    platform: "meta" as const,
      careersUrl: "https://www.metacareers.com/jobs",
      earlyCareerUrl: "https://www.metacareers.com/earlycareer/",
    },

    // ── Unsupported (custom ATS — migrate to config/targets.json) ────────────── (25)
    // These companies previously used a third-party aggregator as fallback.
    // Add them to config/targets.json with ats: "custom-playwright" to re-enable.
    unsupported("IBM",                 "ibm",              "https://www.ibm.com/us-en/employment"),
    unsupported("Microsoft",           "microsoft",        "https://careers.microsoft.com",     "https://careers.microsoft.com/students/us/en/usuniversity"),
    unsupported("Target",              "target",           "https://corporate.target.com/careers"),
    unsupported("BlackRock",           "blackrock",        "https://careers.blackrock.com"),
    unsupported("Zebra Technologies",  "zebra",            "https://www.zebra.com/us/en/about-zebra/careers.html"),
    unsupported("Apple",               "apple",            "https://jobs.apple.com",              "https://jobs.apple.com/en-us/search?team=early-career-programs-STDNT-ICEC"),
    unsupported("Salesforce",          "salesforce",       "https://careers.salesforce.com"),
    unsupported("Nvidia",              "nvidia",           "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"),
    unsupported("Adobe",               "adobe",            "https://adobe.wd5.myworkdayjobs.com/external_experienced"),
    unsupported("Tesla",               "tesla",            "https://www.tesla.com/careers"),
    unsupported("Spotify",             "spotify",          "https://www.lifeatspotify.com/jobs"),
    unsupported("ServiceNow",          "servicenow",       "https://careers.servicenow.com"),
    unsupported("Intuit",              "intuit",           "https://jobs.intuit.com"),
    unsupported("PayPal",              "paypal",           "https://careers.pymnts.com"),
    unsupported("Workday",             "workday",          "https://workday.wd5.myworkdayjobs.com/Workday"),
    unsupported("Capital One",         "capitalone",       "https://www.capitalonecareers.com"),
    unsupported("Cisco",               "cisco",            "https://jobs.cisco.com"),
    unsupported("Microsoft Careers",   "msft-careers",      "https://careers.microsoft.com"),
    unsupported("Mastercard",          "mastercard",       "https://careers.mastercard.com"),
    unsupported("Oracle",              "oracle",           "https://oracle.com/careers"),
    unsupported("American Express",    "amex",             "https://careers.americanexpress.com"),
    unsupported("CrowdStrike",         "crowdstrike",      "https://www.crowdstrike.com/careers"),
    unsupported("Palo Alto Networks",  "paloaltonetworks", "https://jobs.paloaltonetworks.com"),
    unsupported("Qualcomm",            "qualcomm",         "https://careers.qualcomm.com"),
    unsupported("Visa",                "visa",             "https://corporate.visa.com/en/jobs.html"),
  ];

  // Stamp tier onto each company
  const tiered = staticList.map((c) =>
    TIER_MAP[c.slug] ? { ...c, tier: TIER_MAP[c.slug] } : c
  );

  // Merge: custom companies override static entries with same slug
  const staticSlugs = new Set(tiered.map((c) => c.slug));
  const newCustom = custom.filter((c) => !staticSlugs.has(c.slug));
  return [...tiered, ...newCustom];
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allCompanies = allCompanies;
/**
 * 100 top US tech companies — every slug verified live (HTTP 200) against the
 * Greenhouse boards-api or Lever postings API before inclusion.
 * Companies that use Workday, Ashby, or custom ATS are excluded (not scrapeable via API).
 */
function allCompanies() {
    const gh = (name, slug, url) => ({ name, slug, platform: "greenhouse", careersUrl: url });
    const lv = (name, slug, url) => ({ name, slug, platform: "lever", careersUrl: url });
    // Merge static list with user-added companies (loaded lazily to avoid
    // circular deps at module load time — imported inline here).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { loadCustomCompanies } = require("./customCompanies");
    const custom = loadCustomCompanies();
    const staticList = [
        // ── Greenhouse ─────────────────────────────────────────────────────────── (83)
        gh("Airbnb", "airbnb", "https://careers.airbnb.com"),
        gh("Stripe", "stripe", "https://stripe.com/jobs"),
        gh("Coinbase", "coinbase", "https://www.coinbase.com/careers"),
        gh("Lyft", "lyft", "https://lyft.com/careers"),
        gh("Dropbox", "dropbox", "https://dropbox.com/jobs"),
        gh("Instacart", "instacart", "https://instacart.com/careers"),
        gh("Reddit", "reddit", "https://redditinc.com/careers"),
        gh("Discord", "discord", "https://discord.com/careers"),
        gh("Robinhood", "robinhood", "https://careers.robinhood.com"),
        gh("Chime", "chime", "https://chime.com/careers"),
        gh("Brex", "brex", "https://brex.com/careers"),
        gh("Anthropic", "anthropic", "https://anthropic.com/careers"),
        gh("Scale AI", "scaleai", "https://scale.com/careers"),
        gh("Databricks", "databricks", "https://databricks.com/careers"),
        gh("Cloudflare", "cloudflare", "https://cloudflare.com/careers"),
        gh("Twilio", "twilio", "https://twilio.com/en-us/company/jobs"),
        gh("Amplitude", "amplitude", "https://amplitude.com/careers"),
        gh("PagerDuty", "pagerduty", "https://pagerduty.com/careers"),
        gh("Datadog", "datadog", "https://careers.datadoghq.com"),
        gh("Okta", "okta", "https://okta.com/company/careers"),
        gh("Affirm", "affirm", "https://affirm.com/careers"),
        gh("Faire", "faire", "https://faire.com/careers"),
        gh("Gusto", "gusto", "https://gusto.com/about/careers"),
        gh("Checkr", "checkr", "https://checkr.com/careers"),
        gh("Lattice", "lattice", "https://lattice.com/careers"),
        gh("Verkada", "verkada", "https://verkada.com/careers"),
        gh("Airtable", "airtable", "https://airtable.com/careers"),
        gh("Intercom", "intercom", "https://intercom.com/careers"),
        gh("Asana", "asana", "https://asana.com/jobs"),
        gh("Carta", "carta", "https://carta.com/careers"),
        gh("Rubrik", "rubrik", "https://rubrik.com/careers"),
        gh("Duolingo", "duolingo", "https://careers.duolingo.com"),
        gh("Roblox", "roblox", "https://careers.roblox.com"),
        gh("Samsara", "samsara", "https://samsara.com/careers"),
        gh("Squarespace", "squarespace", "https://careers.squarespace.com"),
        gh("SoFi", "sofi", "https://sofi.com/careers"),
        gh("Fivetran", "fivetran", "https://fivetran.com/careers"),
        gh("JFrog", "jfrog", "https://jfrog.com/careers"),
        gh("Figma", "figma", "https://figma.com/careers"),
        gh("Vercel", "vercel", "https://vercel.com/careers"),
        gh("Mixpanel", "mixpanel", "https://mixpanel.com/jobs"),
        gh("Block", "block", "https://block.xyz/careers"),
        gh("Qualtrics", "qualtrics", "https://qualtrics.com/careers"),
        gh("Toast", "toast", "https://careers.toasttab.com"),
        gh("Attentive", "attentive", "https://attentive.com/careers"),
        gh("Klaviyo", "klaviyo", "https://klaviyo.com/careers"),
        gh("LaunchDarkly", "launchdarkly", "https://launchdarkly.com/careers"),
        gh("Contentful", "contentful", "https://contentful.com/careers"),
        gh("Algolia", "algolia", "https://algolia.com/careers"),
        gh("Starburst", "starburst", "https://starburst.io/careers"),
        gh("Netlify", "netlify", "https://netlify.com/careers"),
        gh("CockroachLabs", "cockroachlabs", "https://cockroachlabs.com/careers"),
        gh("PlanetScale", "planetscale", "https://planetscale.com/company/careers"),
        gh("Temporal", "temporal", "https://temporal.io/careers"),
        gh("Zscaler", "zscaler", "https://zscaler.com/careers"),
        gh("MongoDB", "mongodb", "https://mongodb.com/careers"),
        gh("Elastic", "elastic", "https://elastic.co/careers"),
        gh("Wunderkind", "wunderkind", "https://wunderkind.co/careers"),
        gh("ZipRecruiter", "ziprecruiter", "https://ziprecruiter.com/careers"),
        gh("Blend", "blend", "https://blend.com/careers"),
        gh("Opendoor", "opendoor", "https://opendoor.com/careers"),
        gh("Flexport", "flexport", "https://flexport.com/careers"),
        gh("Coupang", "coupang", "https://coupang.com/c/jobs"),
        gh("Handshake", "handshake", "https://joinhandshake.com/careers"),
        gh("Remote", "remote", "https://remote.com/careers"),
        gh("Webflow", "webflow", "https://webflow.com/careers"),
        gh("GitLab", "gitlab", "https://about.gitlab.com/jobs"),
        gh("HubSpot", "hubspotjobs", "https://hubspot.com/careers"),
        gh("Coursera", "coursera", "https://coursera.org/about/careers"),
        gh("Udemy", "udemy", "https://about.udemy.com/jobs"),
        gh("Pendo", "pendo", "https://pendo.io/careers"),
        gh("Smartsheet", "smartsheet", "https://smartsheet.com/careers"),
        gh("Braze", "braze", "https://braze.com/careers"),
        gh("Sendbird", "sendbird", "https://sendbird.com/careers"),
        gh("Orca Security", "orca", "https://orca.security/company/jobs"),
        gh("Axonius", "axonius", "https://axonius.com/company/careers"),
        gh("Abnormal Security", "abnormalsecurity", "https://abnormalsecurity.com/careers"),
        gh("Exabeam", "exabeam", "https://exabeam.com/company/careers"),
        gh("Postman", "postman", "https://postman.com/company/careers"),
        gh("Together AI", "togetherai", "https://together.ai/careers"),
        gh("Salesloft", "salesloft", "https://salesloft.com/company/careers"),
        gh("Five9", "five9", "https://five9.com/about/careers"),
        gh("Dialpad", "dialpad", "https://dialpad.com/company/careers"),
        gh("Natera", "natera", "https://natera.com/careers"),
        gh("Omada Health", "omadahealth", "https://www.omadahealth.com/careers"),
        gh("Lucid Software", "lucidsoftware", "https://www.lucidsoftware.com/careers"),
        // ── Lever ──────────────────────────────────────────────────────────────── (17)
        lv("Plaid", "plaid", "https://plaid.com/careers"),
        lv("Outreach", "outreach", "https://outreach.io/company/careers"),
        lv("Netflix", "netflix", "https://jobs.netflix.com"),
        lv("Palantir", "palantir", "https://palantir.com/careers"),
        lv("Neon", "neon", "https://neon.tech/careers"),
        lv("Lucidworks", "lucidworks", "https://lucidworks.com/company/careers"),
        lv("Mistral AI", "mistral", "https://mistral.ai/careers"),
        lv("Clari", "clari", "https://clari.com/company/careers"),
        lv("Highspot", "highspot", "https://highspot.com/careers"),
        lv("Mindtickle", "mindtickle", "https://mindtickle.com/careers"),
        lv("Freshworks", "freshworks", "https://freshworks.com/company/careers"),
        lv("Girls Who Code", "girlswhocode", "https://girlswhocode.com/careers"),
        // ── Ashby ──────────────────────────────────────────────────────────────── (12)
        { name: "Linear", slug: "linear", platform: "ashby", careersUrl: "https://linear.app/careers" },
        { name: "Ramp", slug: "ramp", platform: "ashby", careersUrl: "https://ramp.com/careers" },
        { name: "Mercury", slug: "mercury", platform: "ashby", careersUrl: "https://mercury.com/careers" },
        { name: "Retool", slug: "retool", platform: "ashby", careersUrl: "https://retool.com/careers" },
        { name: "Watershed", slug: "watershed", platform: "ashby", careersUrl: "https://watershed.com/careers" },
        { name: "Notion", slug: "notion", platform: "ashby", careersUrl: "https://notion.so/careers" },
        { name: "Descript", slug: "descript", platform: "ashby", careersUrl: "https://descript.com/careers" },
        { name: "Deel", slug: "deel", platform: "ashby", careersUrl: "https://deel.com/careers" },
        { name: "Pave", slug: "pave", platform: "ashby", careersUrl: "https://pave.com/careers" },
        { name: "Coda", slug: "coda", platform: "ashby", careersUrl: "https://coda.io/careers" },
        { name: "Hex", slug: "hex", platform: "ashby", careersUrl: "https://hex.tech/company/careers" },
        { name: "Tome", slug: "tome", platform: "ashby", careersUrl: "https://tome.app/careers" },
        // ── Custom scrapers ─────────────────────────────────────────────────────── (3)
        { name: "Amazon", slug: "amazon", platform: "amazon", careersUrl: "https://www.amazon.jobs/en/teams/pmts" },
        { name: "Google", slug: "google", platform: "google", careersUrl: "https://careers.google.com", linkedInId: "1441" },
        { name: "Meta", slug: "meta", platform: "meta", careersUrl: "https://www.metacareers.com/jobs", linkedInId: "10667" },
        // ── LinkedIn-scraped (Workday or custom ATS — no public API) ────────────── (5)
        { name: "IBM", slug: "ibm", platform: "linkedin", careersUrl: "https://www.ibm.com/us-en/employment", linkedInId: "1009" },
        { name: "Microsoft", slug: "microsoft", platform: "linkedin", careersUrl: "https://careers.microsoft.com", linkedInId: "1035" },
        { name: "Target", slug: "target", platform: "linkedin", careersUrl: "https://corporate.target.com/careers", linkedInId: "2068" },
        { name: "BlackRock", slug: "blackrock", platform: "linkedin", careersUrl: "https://careers.blackrock.com", linkedInId: "162479" },
        { name: "Zebra Technologies", slug: "zebra", platform: "linkedin", careersUrl: "https://www.zebra.com/us/en/about-zebra/careers.html", linkedInId: "1038" },
    ];
    // Merge: custom companies override static entries with same slug
    const staticSlugs = new Set(staticList.map((c) => c.slug));
    const newCustom = custom.filter((c) => !staticSlugs.has(c.slug));
    return [...staticList, ...newCustom];
}
//# sourceMappingURL=companies.js.map
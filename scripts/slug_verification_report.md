# Slug Verification Report
Generated: 2026-04-20

## Method
For each company, tried Greenhouse → Lever → Ashby in order, with ≥200ms between requests.
LinkedIn IDs verified via the guest jobs API (`f_C={id}` filter).

## API-based companies

| Company | GH status | LV status | AS status | Result |
|---|---|---|---|---|
| Atlassian | 404 (`atlassian`) | **200** (`atlassian`) | — | ✅ Lever: `atlassian` |
| Snowflake | 404 (`snowflake`, `snowflake-computing`) | 404 (`snowflake`) | **200** (`snowflake`) | ✅ Ashby: `snowflake` |
| Glean | 404 (`glean`) | 404 (`glean`) | 404 (`glean`) | ✅ GH: `gleanwork` (alt slug) |
| OpenAI | 404 (`openai`) | 000 — timeout | **200** (`openai`) | ✅ Ashby: `openai` |
| Project44 | **200** (`project44`) | — | — | ✅ GH: `project44` |
| Anduril | 404 (`anduril`, `anduril-industries`) | 404 (`anduril`) | 404 (`anduril`) | ✅ GH: `andurilindustries` (alt slug) |
| Headway | **200** (`headway`) | — | — | ✅ GH: `headway` |
| Cedar | 404 (`cedar`, `cedar-health`) | 404 (`cedar`) | **200** (`cedar`) | ✅ Ashby: `cedar` |
| Devoted Health | 404 all slugs tried | 404 all slugs tried | 404 all slugs tried | ❌ needs_manual_lookup |
| Alma | **200** (`alma`) | — | — | ✅ GH: `alma` |
| Uber Freight | **200** (`uberfreight`) | — | — | ✅ GH: `uberfreight` |

## LinkedIn / Workday companies

| Company | LinkedIn ID | API check | Result |
|---|---|---|---|
| LinkedIn | 1337 | ok | ✅ Confirmed |
| Oracle | 1028 | ok | ✅ Confirmed |
| Mastercard | 15564 | ok | ✅ Confirmed |
| Capital One | 3007 | ok | ✅ Confirmed |
| Cisco | 1063 | ok | ✅ Confirmed |
| Visa | 2278, 184648 | empty (rate-limited) | ⚠️ Added without ID — keyword fallback |
| American Express | 4139, 1267938 | empty (rate-limited) | ⚠️ Added without ID — keyword fallback |
| Qualcomm | 2045, 6539 | empty (rate-limited) | ⚠️ Added without ID — keyword fallback |
| Palo Alto Networks | 119567, 2130704, 5227850 | empty (rate-limited) | ⚠️ Added without ID — keyword fallback |
| CrowdStrike | 2739048, 5688090, 6428669 | empty (rate-limited) | ⚠️ Added without ID — keyword fallback |

## Companies needing manual lookup

| Company | Reason |
|---|---|
| Devoted Health | Not found on GH/LV/AS under any slug variant tried (`devotedhealth`, `devoted`, `devoted-health`, `devotedhealthcare`) |

## Already tracked (no action needed)

Airbnb, Algolia, Alma*, Amazon, Anthropic, Apple, Asana, Block, Brex, Carta,
Coinbase, Databricks, DoorDash, Elastic, Figma, Flexport, Google, Gusto,
HubSpot, IBM, Instacart, Intuit, Linear, Lyft, Mercury, Meta, Microsoft,
MongoDB, Netflix, Notion, Nvidia, Okta, OpenAI*, Opendoor, Palantir,
Perplexity, Pinterest, Plaid, Ramp, Retool, Rippling, Samsara, Salesforce,
Scale AI, ServiceNow, Snap, Spotify, Stripe, Toast, Uber, Vercel,
Webflow, Workday

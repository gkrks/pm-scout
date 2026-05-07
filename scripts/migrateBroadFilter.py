#!/usr/bin/env python3
"""
Migrate broad-filter (product in title) companies from both Ashby and Greenhouse
into targets.json and ats_routing.json.
"""

import csv, hashlib, json, uuid
from datetime import datetime, timezone

TARGETS_PATH = "config/targets.json"
ROUTING_PATH = "config/ats_routing.json"
UUID_NAMESPACE = uuid.UUID("a3f7b2c1-9e5d-4a8f-b2c1-d6e9f0a4b3c2")

DEFAULT_TARGET_ROLES = [
    "Product Manager", "Associate Product Manager",
    "Forward Deployed Product Manager", "Associate Forward Deployed Product Manager",
]

def slug_to_name(slug, csv_name):
    if csv_name and csv_name.strip():
        return csv_name.strip()
    return " ".join(w.capitalize() for w in slug.replace("-", " ").replace("_", " ").split())

def content_hash(entry):
    raw = json.dumps({k: v for k, v in sorted(entry.items()) if k not in ("uuid", "index", "content_hash")}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]

def categorize(name, titles):
    low = (name + " " + titles).lower()
    if any(k in low for k in ("health", "medical", "clinical", "care", "pharma", "bio", "therapy")):
        return "Healthcare & Biotech", ["Healthcare"]
    if any(k in low for k in ("fintech", "bank", "payment", "insurance", "lending", "credit", "trading")):
        return "Fintech & Financial Services", ["Fintech"]
    if any(k in low for k in ("ai", "ml", "model", "llm", "intelligence", "machine learning")):
        return "AI Labs & Foundation Model Companies", ["AI/ML"]
    if any(k in low for k in ("security", "cyber", "auth", "identity")):
        return "Cybersecurity & Identity", ["Security"]
    if any(k in low for k in ("crypto", "web3", "blockchain", "defi")):
        return "Crypto & Web3", ["Crypto"]
    if any(k in low for k in ("robot", "auto", "hardware", "drone", "vehicle")):
        return "Robotics & Hardware", ["Robotics"]
    if any(k in low for k in ("energy", "climate", "clean", "solar")):
        return "Climate & Energy", ["Climate"]
    if any(k in low for k in ("education", "edtech", "learn")):
        return "Education & EdTech", ["Education"]
    return "Tech Companies (General)", ["Technology"]

def main():
    with open(TARGETS_PATH) as f:
        targets = json.load(f)
    with open(ROUTING_PATH) as f:
        routing_data = json.load(f)
    routing = routing_data["routing"]

    existing_company_slugs = {k.lower() for k in routing}
    existing_ats_slugs = set()
    for key, val in routing.items():
        existing_ats_slugs.add((val.get("slug") or key).lower())
    existing_target_slugs = {c["slug"].lower() for c in targets["companies"]}
    max_index = max((c.get("index", 0) for c in targets["companies"]), default=0)

    sources = [
        ("ashby-product-usa.csv", "ashby", "ashby-product-pipeline", "https://jobs.ashbyhq.com/{slug}", "product_titles"),
        ("greenhouse-product-usa.csv", "greenhouse", "greenhouse-product-pipeline", "https://boards.greenhouse.io/{slug}", "product_titles"),
    ]

    total_targets = 0
    total_routes = 0

    for csv_path, ats, method, url_tpl, title_col in sources:
        added_t = 0
        added_r = 0
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                slug = row["slug"].strip()
                if slug.lower() in existing_ats_slugs:
                    continue

                company_name = slug_to_name(slug, row.get("company_name", ""))
                titles = row.get(title_col, "")
                category, domain_tags = categorize(company_name, titles)
                company_uuid = str(uuid.uuid5(UUID_NAMESPACE, slug))
                careers_url = url_tpl.format(slug=slug)

                entry = {
                    "uuid": company_uuid, "slug": slug, "name": company_name,
                    "category": category, "careers_url": careers_url,
                    "program_url": None, "has_apm_program": False,
                    "apm_program_name": None, "apm_program_status": None,
                    "domain_tags": domain_tags, "target_roles": DEFAULT_TARGET_ROLES,
                    "notes": f"{ats.title()} product discovery {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
                }
                entry["content_hash"] = content_hash(entry)
                max_index += 1
                entry["index"] = max_index

                if slug.lower() not in existing_target_slugs:
                    targets["companies"].append(entry)
                    existing_target_slugs.add(slug.lower())
                    added_t += 1

                if slug.lower() not in existing_company_slugs:
                    routing[slug] = {
                        "ats": ats, "slug": slug,
                        "_discovery_method": method,
                        "_discovered_at": datetime.now(timezone.utc).isoformat(),
                    }
                    existing_company_slugs.add(slug.lower())
                    existing_ats_slugs.add(slug.lower())
                    added_r += 1

        print(f"{ats.title()}: +{added_t} targets, +{added_r} routes")
        total_targets += added_t
        total_routes += added_r

    targets["metadata"]["total_companies"] = len(targets["companies"])
    targets["metadata"]["generated_at"] = datetime.now(timezone.utc).isoformat()

    with open(TARGETS_PATH, "w") as f:
        json.dump(targets, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(ROUTING_PATH, "w") as f:
        json.dump(routing_data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nTotal: +{total_targets} targets, +{total_routes} routes")
    print(f"Grand total companies: {len(targets['companies'])}")

if __name__ == "__main__":
    main()

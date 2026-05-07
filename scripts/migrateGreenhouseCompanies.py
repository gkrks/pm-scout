#!/usr/bin/env python3
"""
Migrate Greenhouse PM-in-USA companies into targets.json and ats_routing.json.
"""

import csv, hashlib, json, uuid, re
from datetime import datetime, timezone

TARGETS_PATH = "config/targets.json"
ROUTING_PATH = "config/ats_routing.json"
CSV_PATH = "greenhouse-pm-usa.csv"

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

def categorize(slug, name, pm_titles):
    low = (name + " " + pm_titles).lower()
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

    existing_gh_slugs = set()
    existing_company_slugs = set()
    for key, val in routing.items():
        existing_company_slugs.add(key.lower())
        if val.get("ats") == "greenhouse":
            existing_gh_slugs.add((val.get("slug") or key).lower())

    existing_target_slugs = {c["slug"].lower() for c in targets["companies"]}

    new_companies = []
    with open(CSV_PATH) as f:
        for row in csv.DictReader(f):
            gh_slug = row["slug"].strip()
            if gh_slug.lower() in existing_gh_slugs:
                continue
            new_companies.append(row)

    print(f"Existing Greenhouse routes: {len(existing_gh_slugs)}")
    print(f"Net new to add: {len(new_companies)}")

    max_index = max((c.get("index", 0) for c in targets["companies"]), default=0)
    added_targets = 0
    added_routes = 0

    for i, row in enumerate(new_companies):
        gh_slug = row["slug"].strip()
        company_name = slug_to_name(gh_slug, row.get("company_name", ""))
        pm_titles = row.get("pm_titles", "")
        company_slug = gh_slug
        category, domain_tags = categorize(gh_slug, company_name, pm_titles)
        company_uuid = str(uuid.uuid5(UUID_NAMESPACE, company_slug))
        careers_url = f"https://boards.greenhouse.io/{gh_slug}"

        entry = {
            "uuid": company_uuid,
            "slug": company_slug,
            "name": company_name,
            "category": category,
            "careers_url": careers_url,
            "program_url": None,
            "has_apm_program": False,
            "apm_program_name": None,
            "apm_program_status": None,
            "domain_tags": domain_tags,
            "target_roles": DEFAULT_TARGET_ROLES,
            "notes": f"Greenhouse discovery {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
        }
        entry["content_hash"] = content_hash(entry)
        entry["index"] = max_index + i + 1

        if company_slug.lower() not in existing_target_slugs:
            targets["companies"].append(entry)
            existing_target_slugs.add(company_slug.lower())
            added_targets += 1

        if company_slug.lower() not in existing_company_slugs:
            routing[company_slug] = {
                "ats": "greenhouse",
                "slug": gh_slug,
                "_discovery_method": "greenhouse-pm-usa-pipeline",
                "_discovered_at": datetime.now(timezone.utc).isoformat(),
            }
            existing_company_slugs.add(company_slug.lower())
            added_routes += 1

    targets["metadata"]["total_companies"] = len(targets["companies"])
    targets["metadata"]["generated_at"] = datetime.now(timezone.utc).isoformat()

    with open(TARGETS_PATH, "w") as f:
        json.dump(targets, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(ROUTING_PATH, "w") as f:
        json.dump(routing_data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nResults:")
    print(f"  targets.json: +{added_targets} companies (total: {len(targets['companies'])})")
    print(f"  ats_routing.json: +{added_routes} routes")

if __name__ == "__main__":
    main()

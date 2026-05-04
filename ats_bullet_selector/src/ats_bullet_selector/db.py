"""Database adapter: reads job_listings from Supabase REST API and master resume from JSON."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any, Optional

import httpx
import structlog

from .config import DEFAULT_MASTER_RESUME_PATH, SUPABASE_KEY, SUPABASE_URL
from .models import Bullet, Qualification, QualKind, SourceType

logger = structlog.get_logger()


# --------------------------------------------------------------------------- #
#  Master resume loader
# --------------------------------------------------------------------------- #

def load_master_resume(
    path: Optional[str | Path] = None,
) -> list[Bullet]:
    """Load master_resume.json into a flat list of Bullet objects."""
    resume_path = Path(path) if path else DEFAULT_MASTER_RESUME_PATH
    with open(resume_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    bullets: list[Bullet] = []
    today = date.today()

    for exp in data.get("experiences", []):
        source_id = exp["id"]
        source_label = f"{exp['company']} -- {exp['role']}"
        end_raw = exp.get("end_date")

        for b in exp.get("bullets", []):
            end_date = _parse_end_date(end_raw)
            recency = _months_between(end_date, today) if end_date else 0.0
            bullets.append(Bullet(
                bullet_id=b["id"],
                source_id=source_id,
                source_type=SourceType.experience,
                source_label=source_label,
                role=exp["role"],
                start_date=exp.get("start_date", ""),
                end_date=end_raw,
                text=b["text"],
                technologies=b.get("skills", []),
                recency_months=recency,
            ))

    for proj in data.get("projects", []):
        source_id = proj["id"]
        source_label = f"{proj['name']}"

        for b in proj.get("bullets", []):
            bullets.append(Bullet(
                bullet_id=b["id"],
                source_id=source_id,
                source_type=SourceType.project,
                source_label=source_label,
                role=proj.get("name", ""),
                start_date=proj.get("start_date", ""),
                end_date=proj.get("end_date"),
                text=b["text"],
                technologies=b.get("skills", []),
                recency_months=0.0,  # projects treated as current
            ))

    logger.info("master_resume_loaded", bullet_count=len(bullets), path=str(resume_path))
    return bullets


def load_master_resume_raw(
    path: Optional[str | Path] = None,
) -> dict[str, Any]:
    """Load master_resume.json as raw dict (for slot mapping in generation)."""
    resume_path = Path(path) if path else DEFAULT_MASTER_RESUME_PATH
    with open(resume_path, "r", encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------------------------------------- #
#  Job listing loader (Supabase REST API)
# --------------------------------------------------------------------------- #

_JOB_SELECT = ",".join([
    "id", "title", "role_url", "location_raw", "location_city",
    "is_remote", "is_hybrid", "ats_platform",
    "jd_job_title", "jd_company_name",
    "jd_required_qualifications", "jd_preferred_qualifications",
    "jd_skills", "jd_role_context", "jd_experience",
    "company_id",
])


def load_job_listing(job_id: str) -> dict[str, Any]:
    """Load a single job listing by UUID from Supabase REST API."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set")

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    # Fetch the job listing
    job_resp = httpx.get(
        f"{SUPABASE_URL}/rest/v1/job_listings",
        params={"select": _JOB_SELECT, "id": f"eq.{job_id}"},
        headers=headers,
        timeout=10.0,
    )
    job_resp.raise_for_status()
    rows = job_resp.json()

    if not rows:
        raise ValueError(f"job_id {job_id} not found in job_listings")

    row = rows[0]

    # Fetch the company name
    company_id = row.get("company_id")
    company_name = ""
    company_slug = ""
    if company_id:
        co_resp = httpx.get(
            f"{SUPABASE_URL}/rest/v1/companies",
            params={"select": "name,slug", "id": f"eq.{company_id}"},
            headers=headers,
            timeout=10.0,
        )
        co_resp.raise_for_status()
        co_rows = co_resp.json()
        if co_rows:
            company_name = co_rows[0].get("name", "")
            company_slug = co_rows[0].get("slug", "")

    row["company_name"] = company_name
    row["company_slug"] = company_slug

    logger.info("job_listing_loaded", job_id=job_id, company=company_name)
    return row


def extract_qualifications(job_row: dict[str, Any]) -> list[Qualification]:
    """Extract qualifications from a job_listings row into Qualification objects."""
    quals: list[Qualification] = []

    required = job_row.get("jd_required_qualifications") or []
    for i, text in enumerate(required):
        quals.append(Qualification(
            id=f"q_basic_{i}",
            kind=QualKind.basic,
            text=str(text),
        ))

    preferred = job_row.get("jd_preferred_qualifications") or []
    for i, text in enumerate(preferred):
        quals.append(Qualification(
            id=f"q_preferred_{i}",
            kind=QualKind.preferred,
            text=str(text),
        ))

    logger.info(
        "qualifications_extracted",
        basic_count=len(required),
        preferred_count=len(preferred),
    )
    return quals


# --------------------------------------------------------------------------- #
#  Helpers
# --------------------------------------------------------------------------- #

def _parse_end_date(raw: Optional[str]) -> Optional[date]:
    """Parse 'YYYY-MM' or 'Present'/None into a date (1st of month)."""
    if raw is None or raw.lower() == "present":
        return date.today()
    parts = raw.split("-")
    if len(parts) >= 2:
        return date(int(parts[0]), int(parts[1]), 1)
    return None


def _months_between(d1: date, d2: date) -> float:
    """Approximate months between two dates."""
    return (d2.year - d1.year) * 12.0 + (d2.month - d1.month)

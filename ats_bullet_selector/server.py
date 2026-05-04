"""FastAPI server for the ATS bullet selector microservice."""

from __future__ import annotations

import asyncio
from collections import defaultdict

import structlog
import uvicorn
from fastapi import FastAPI, HTTPException

from src.ats_bullet_selector.assign import solve_assignment
from src.ats_bullet_selector.classify import classify_qualifications
from src.ats_bullet_selector.config import JUDGE_MODEL, SOURCE_BULLET_CAP
from src.ats_bullet_selector.db import (
    extract_qualifications,
    load_job_listing,
    load_master_resume,
    load_master_resume_raw,
)
from src.ats_bullet_selector.judge import (
    get_judge_cache_size,
    get_system_prompt_hash,
    judge_pairs_async,
)
from src.ats_bullet_selector.models import (
    FinalSelection,
    HealthResponse,
    PreResolvedResult,
    QualCandidates,
    QualCategory,
    ResolvedBullet,
    ScoreRequest,
    ScoreResponse,
    SelectRequest,
    SelectResponse,
)
from src.ats_bullet_selector.report import generate_report
from src.ats_bullet_selector.resolve import (
    resolve_education,
    resolve_experience_years,
    resolve_skill_check,
)
from src.ats_bullet_selector.retrieve import get_cache_size, retrieve_top_k
from src.ats_bullet_selector.score import score_candidate

logger = structlog.get_logger()

app = FastAPI(title="ATS Bullet Selector", version="0.1.0")


@app.post("/score", response_model=ScoreResponse)
async def score_job(req: ScoreRequest) -> ScoreResponse:
    """Run the full Stage A-E pipeline for a job listing."""
    try:
        job_row = load_job_listing(req.job_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    qualifications = extract_qualifications(job_row)
    if not qualifications:
        raise HTTPException(
            status_code=422,
            detail="No qualifications found in extracted JD for this job",
        )

    bullets = load_master_resume(req.master_resume_path)
    resume_raw = load_master_resume_raw(req.master_resume_path)
    ats_vendor = job_row.get("ats_platform")

    # Classify qualifications into routing categories
    all_skills = [
        s for group in resume_raw.get("skills", []) for s in group.get("skills", [])
    ]
    qualifications = classify_qualifications(qualifications, all_skills)

    # Partition: resolve non-bullet quals deterministically
    pre_resolved: list[PreResolvedResult] = []
    bullet_quals = []
    for qual in qualifications:
        if qual.category == QualCategory.education_check:
            pre_resolved.append(resolve_education(qual, resume_raw))
        elif qual.category == QualCategory.experience_years:
            pre_resolved.append(resolve_experience_years(qual, resume_raw))
        elif qual.category == QualCategory.skill_check:
            pre_resolved.append(resolve_skill_check(qual, resume_raw))
        else:
            bullet_quals.append(qual)

    # Stage A: retrieve top-K candidates per bullet-match qualification
    qual_retrieved: list[tuple] = []  # (qual, [(bullet, sem_sim, lit_cov)])
    for qual in bullet_quals:
        retrieved = retrieve_top_k(qual, bullets)
        qual_retrieved.append((qual, retrieved))

    # Stage B: judge all pairs
    all_pairs = []
    pair_index = []  # (qual_idx, cand_idx) for reassembly
    for qi, (qual, retrieved) in enumerate(qual_retrieved):
        for ci, (bullet, sem_sim, lit_cov) in enumerate(retrieved):
            all_pairs.append((qual, bullet, lit_cov, sem_sim))
            pair_index.append((qi, ci))

    judge_results = await judge_pairs_async(all_pairs, ats_vendor=ats_vendor)

    # Stage C: score and build top-3
    ranked: list[QualCandidates] = []
    for qi, (qual, retrieved) in enumerate(qual_retrieved):
        scored = []
        for ci, (bullet, sem_sim, lit_cov) in enumerate(retrieved):
            flat_idx = next(
                fi for fi, (q, c) in enumerate(pair_index) if q == qi and c == ci
            )
            judge_result = judge_results[flat_idx]
            sc = score_candidate(qual, bullet, judge_result, lit_cov, sem_sim)
            scored.append(sc)

        scored.sort(key=lambda s: s.match_score, reverse=True)
        ranked.append(QualCandidates(
            qualification=qual,
            candidates=scored[:3],
        ))

    # Stage D: ILP assignment
    selection = solve_assignment(ranked)

    # Stage E: report
    generate_report(req.job_id, ranked, selection, pre_resolved=pre_resolved)

    return ScoreResponse(
        job_id=req.job_id,
        model_version=JUDGE_MODEL,
        system_prompt_hash=get_system_prompt_hash(),
        ranked_candidates=ranked,
        final_selection=selection,
        pre_resolved=pre_resolved,
    )


@app.post("/select", response_model=SelectResponse)
async def validate_selections(req: SelectRequest) -> SelectResponse:
    """Validate user selections and check cap violations."""
    bullets = load_master_resume()
    bullet_map = {b.bullet_id: b for b in bullets}

    resolved: list[ResolvedBullet] = []
    source_counts: dict[str, int] = defaultdict(int)
    warnings: list[str] = []

    for sel in req.user_selections:
        if sel.is_custom:
            resolved.append(ResolvedBullet(
                qualification_id=sel.qualification_id,
                bullet_id=None,
                text=sel.bullet_id_or_text,
                source_id=None,
                is_custom=True,
            ))
        else:
            bullet = bullet_map.get(sel.bullet_id_or_text)
            if bullet is None:
                warnings.append(
                    f"Bullet '{sel.bullet_id_or_text}' not found in master resume"
                )
                resolved.append(ResolvedBullet(
                    qualification_id=sel.qualification_id,
                    bullet_id=sel.bullet_id_or_text,
                    text="[NOT FOUND]",
                    source_id=None,
                    is_custom=False,
                ))
            else:
                source_counts[bullet.source_id] += 1
                resolved.append(ResolvedBullet(
                    qualification_id=sel.qualification_id,
                    bullet_id=bullet.bullet_id,
                    text=bullet.text,
                    source_id=bullet.source_id,
                    is_custom=False,
                ))

    # Check cap violations
    for source_id, count in source_counts.items():
        if count > SOURCE_BULLET_CAP:
            warnings.append(
                f"Source '{source_id}' would have {count} bullets (cap is {SOURCE_BULLET_CAP})"
            )

    return SelectResponse(
        ok=len([w for w in warnings if "not found" in w.lower()]) == 0,
        warnings=warnings,
        resolved_bullets=resolved,
    )


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_version=JUDGE_MODEL,
        cache_size=get_cache_size() + get_judge_cache_size(),
    )


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)

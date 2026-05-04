"""CLI entrypoint for local debugging: ats-select --job-id <id>"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict

from .assign import solve_assignment
from .classify import classify_qualifications
from .config import JUDGE_MODEL
from .db import extract_qualifications, load_job_listing, load_master_resume, load_master_resume_raw
from .judge import get_system_prompt_hash, judge_pairs_async
from .models import PreResolvedResult, QualCategory
from .report import generate_report
from .resolve import resolve_education, resolve_experience_years, resolve_skill_check
from .retrieve import retrieve_top_k
from .score import score_candidate


async def _run(job_id: str, resume_path: str | None, verbose: bool) -> None:
    print(f"Loading job {job_id}...")
    job_row = load_job_listing(job_id)
    print(f"  Company: {job_row['company_name']}")
    print(f"  Title:   {job_row['title']}")
    print(f"  ATS:     {job_row.get('ats_platform', 'unknown')}")

    qualifications = extract_qualifications(job_row)
    print(f"  Qualifications: {len(qualifications)} "
          f"({sum(1 for q in qualifications if q.kind.value == 'basic')} basic, "
          f"{sum(1 for q in qualifications if q.kind.value == 'preferred')} preferred)")

    if not qualifications:
        print("No qualifications found. Exiting.")
        sys.exit(1)

    bullets = load_master_resume(resume_path)
    resume_raw = load_master_resume_raw(resume_path)
    print(f"  Resume bullets: {len(bullets)}")
    ats_vendor = job_row.get("ats_platform")

    # Classify qualifications
    all_skills = [
        s for group in resume_raw.get("skills", []) for s in group.get("skills", [])
    ]
    qualifications = classify_qualifications(qualifications, all_skills)

    # Resolve non-bullet quals
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

    if pre_resolved:
        print(f"\nPre-resolved: {len(pre_resolved)} qualifications (0 LLM calls)")
        for pr in pre_resolved:
            status = "MET" if pr.met else "NOT MET"
            print(f"  {pr.qualification_id} [{pr.category.value}]: {status}")
            if pr.evidence:
                print(f"    Evidence: {pr.evidence}")

    # Stage A
    print(f"\nStage A: Retrieving candidates for {len(bullet_quals)} quals...")
    qual_retrieved = []
    for qual in bullet_quals:
        retrieved = retrieve_top_k(qual, bullets)
        qual_retrieved.append((qual, retrieved))
        if verbose:
            print(f"  {qual.id}: {len(retrieved)} candidates")

    # Stage B
    all_pairs = []
    pair_index = []
    for qi, (qual, retrieved) in enumerate(qual_retrieved):
        for ci, (bullet, sem_sim, lit_cov) in enumerate(retrieved):
            all_pairs.append((qual, bullet, lit_cov, sem_sim))
            pair_index.append((qi, ci))

    print(f"\nStage B: Judging {len(all_pairs)} pairs...")
    judge_results = await judge_pairs_async(all_pairs, ats_vendor=ats_vendor)

    # Stage C
    print("Stage C: Scoring...")
    from .models import QualCandidates
    ranked = []
    for qi, (qual, retrieved) in enumerate(qual_retrieved):
        scored = []
        for ci, (bullet, sem_sim, lit_cov) in enumerate(retrieved):
            flat_idx = next(
                fi for fi, (q, c) in enumerate(pair_index) if q == qi and c == ci
            )
            sc = score_candidate(qual, bullet, judge_results[flat_idx], lit_cov, sem_sim)
            scored.append(sc)
        scored.sort(key=lambda s: s.match_score, reverse=True)
        ranked.append(QualCandidates(qualification=qual, candidates=scored[:3]))

    # Stage D
    print("Stage D: Solving ILP...")
    selection = solve_assignment(ranked)

    # Stage E
    print("Stage E: Generating report...")
    out_dir = generate_report(job_id, ranked, selection, pre_resolved=pre_resolved)

    print(f"\nDone. Output: {out_dir}")
    print(f"  Total score: {selection.total_score}")
    print(f"  Selected: {len(selection.selected_bullets)} bullets")
    print(f"  Uncovered: {len(selection.uncovered_qualifications)} qualifications")
    print(f"  Model: {JUDGE_MODEL}")
    print(f"  Prompt hash: {get_system_prompt_hash()}")


def main() -> None:
    parser = argparse.ArgumentParser(description="ATS Bullet Selector CLI")
    parser.add_argument("--job-id", required=True, help="Supabase job_listings UUID")
    parser.add_argument("--resume", default=None, help="Path to master_resume.json")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    asyncio.run(_run(args.job_id, args.resume, args.verbose))


if __name__ == "__main__":
    main()

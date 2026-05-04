"""Stage D: constrained global assignment via ILP (PuLP + CBC)."""

from __future__ import annotations

import hashlib
from collections import defaultdict

import structlog
from pulp import (
    PULP_CBC_CMD,
    LpBinary,
    LpMaximize,
    LpProblem,
    LpStatusOptimal,
    LpVariable,
    lpSum,
    value,
)

from .config import ILP_RANDOM_SEED, ILP_THREADS, MATCH_SCORE_FLOOR, SOURCE_BULLET_CAP
from .models import FinalSelection, QualCandidates, SelectedBullet

logger = structlog.get_logger()


def solve_assignment(
    ranked: list[QualCandidates],
    source_cap: int = SOURCE_BULLET_CAP,
    score_floor: float = MATCH_SCORE_FLOOR,
) -> FinalSelection:
    """Solve the ILP to pick the globally-optimal bullet assignment.

    Maximizes total match_score subject to:
      (1) Each qualification covered by exactly 1 bullet
      (2) y[q,b] <= x[b] (select bullet before assigning)
      (3) Each source contributes <= source_cap bullets
      (4) y[q,b] = 0 if match_score < score_floor
    """
    # Build candidate lookups
    # qual_id -> [(bullet_id, source_id, match_score)]
    qual_candidates: dict[str, list[tuple[str, str, float]]] = {}
    bullet_source: dict[str, str] = {}
    all_bullet_ids: set[str] = set()

    for qc in ranked:
        qid = qc.qualification.id
        qual_candidates[qid] = []
        for cand in qc.candidates:
            if cand.match_score >= score_floor:
                qual_candidates[qid].append(
                    (cand.bullet_id, cand.source_id, cand.match_score)
                )
                bullet_source[cand.bullet_id] = cand.source_id
                all_bullet_ids.add(cand.bullet_id)

    # Group bullets by source
    source_bullets: dict[str, set[str]] = defaultdict(set)
    for bid, sid in bullet_source.items():
        source_bullets[sid].add(bid)

    qual_ids = [qc.qualification.id for qc in ranked]

    # Check feasibility: if any qual has 0 candidates after floor, note it
    uncoverable = [qid for qid in qual_ids if not qual_candidates.get(qid)]

    # Try solving with equality constraint first, fall back to <= 1 if infeasible
    result = _solve(
        qual_ids=qual_ids,
        qual_candidates=qual_candidates,
        source_bullets=source_bullets,
        all_bullet_ids=all_bullet_ids,
        bullet_source=bullet_source,
        source_cap=source_cap,
        exact_cover=True,
    )

    if result is None:
        logger.warning(
            "ilp_infeasible_exact",
            qual_count=len(qual_ids),
            source_count=len(source_bullets),
            max_possible=source_cap * len(source_bullets),
        )
        result = _solve(
            qual_ids=qual_ids,
            qual_candidates=qual_candidates,
            source_bullets=source_bullets,
            all_bullet_ids=all_bullet_ids,
            bullet_source=bullet_source,
            source_cap=source_cap,
            exact_cover=False,
        )

    if result is None:
        logger.error("ilp_infeasible_relaxed")
        return FinalSelection(
            selected_bullets=[],
            uncovered_qualifications=qual_ids,
            total_score=0.0,
            source_utilization={},
        )

    selected_x, assigned_y, total_score = result

    # Build output
    bullet_to_quals: dict[str, list[str]] = defaultdict(list)
    covered_quals: set[str] = set()
    for (qid, bid), val in assigned_y.items():
        if val > 0.5:
            bullet_to_quals[bid].append(qid)
            covered_quals.add(qid)

    selected_bullets = [
        SelectedBullet(
            bullet_id=bid,
            source_id=bullet_source[bid],
            covers_qualifications=sorted(qids),
        )
        for bid, qids in sorted(bullet_to_quals.items())
    ]

    uncovered = sorted(set(qual_ids) - covered_quals | set(uncoverable))

    source_util: dict[str, int] = defaultdict(int)
    for sb in selected_bullets:
        source_util[sb.source_id] += 1

    fs = FinalSelection(
        selected_bullets=selected_bullets,
        uncovered_qualifications=uncovered,
        total_score=round(total_score, 1),
        source_utilization=dict(source_util),
    )

    logger.info(
        "ilp_solved",
        total_score=fs.total_score,
        selected_count=len(fs.selected_bullets),
        uncovered_count=len(fs.uncovered_qualifications),
        source_utilization=fs.source_utilization,
    )

    return fs


def _solve(
    qual_ids: list[str],
    qual_candidates: dict[str, list[tuple[str, str, float]]],
    source_bullets: dict[str, set[str]],
    all_bullet_ids: set[str],
    bullet_source: dict[str, str],
    source_cap: int,
    exact_cover: bool,
) -> tuple[dict[str, float], dict[tuple[str, str], float], float] | None:
    """Internal ILP solver. Returns (x_values, y_values, total_score) or None."""

    prob = LpProblem("bullet_assignment", LpMaximize)

    # Variables
    x = {b: LpVariable(f"x_{b}", cat=LpBinary) for b in all_bullet_ids}
    y: dict[tuple[str, str], LpVariable] = {}
    for qid, cands in qual_candidates.items():
        for bid, sid, score in cands:
            y[(qid, bid)] = LpVariable(f"y_{qid}_{bid}", cat=LpBinary)

    # Objective: maximize total match_score + tiebreaker
    obj_terms = []
    for (qid, bid), var in y.items():
        score = _get_score(qual_candidates, qid, bid)
        obj_terms.append(score * var)

    # Tiebreaker: deterministic by bullet_id hash
    for bid, var in x.items():
        h = int(hashlib.md5(bid.encode()).hexdigest()[:8], 16)
        obj_terms.append(1e-6 * (-h / (2**32)) * var)

    prob += lpSum(obj_terms)

    # Constraint (1): each qual covered by exactly/at-most 1 bullet
    for qid in qual_ids:
        cand_vars = [y[(qid, bid)] for bid, sid, s in qual_candidates.get(qid, [])
                     if (qid, bid) in y]
        if cand_vars:
            if exact_cover:
                prob += lpSum(cand_vars) == 1, f"cover_{qid}"
            else:
                prob += lpSum(cand_vars) <= 1, f"cover_{qid}"

    # Constraint (2): y[q,b] <= x[b]
    for (qid, bid), var in y.items():
        prob += var <= x[bid], f"select_{qid}_{bid}"

    # Constraint (3): source cap
    for sid, bids in source_bullets.items():
        source_vars = [x[bid] for bid in bids if bid in x]
        if source_vars:
            prob += lpSum(source_vars) <= source_cap, f"cap_{sid}"

    # Solve
    solver = PULP_CBC_CMD(
        msg=0,
        threads=ILP_THREADS,
        timeLimit=30,
        options=[f"randomSeed {ILP_RANDOM_SEED}"],
    )
    prob.solve(solver)

    if prob.status != LpStatusOptimal:
        return None

    x_vals = {bid: value(var) or 0.0 for bid, var in x.items()}
    y_vals = {k: value(var) or 0.0 for k, var in y.items()}
    total = value(prob.objective) or 0.0

    return x_vals, y_vals, total


def _get_score(
    qual_candidates: dict[str, list[tuple[str, str, float]]],
    qid: str,
    bid: str,
) -> float:
    for b, s, score in qual_candidates.get(qid, []):
        if b == bid:
            return score
    return 0.0

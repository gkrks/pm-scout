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

from .config import (
    GLOBAL_BULLET_CAP,
    ILP_RANDOM_SEED,
    ILP_THREADS,
    KEYWORD_COVERAGE_ENABLED,
    KEYWORD_SLACK_PENALTY,
    MATCH_SCORE_FLOOR,
    MATCH_SCORE_FLOOR_LOWERED,
    SOURCE_BULLET_CAP,
    VALUES_QUAL_SCORE_SCALE,
)
from .keyword_carry import KeywordTerm, find_eligible_bullets
from .models import FinalSelection, QualCandidates, QualCategory, QualKind, SelectedBullet

logger = structlog.get_logger()


def solve_assignment(
    ranked: list[QualCandidates],
    source_cap: int = SOURCE_BULLET_CAP,
    global_cap: int = GLOBAL_BULLET_CAP,
    score_floor: float = MATCH_SCORE_FLOOR,
    must_have_keywords: list[KeywordTerm] | None = None,
    bullet_texts: dict[str, str] | None = None,
) -> FinalSelection:
    """Solve the ILP to pick the globally-optimal bullet assignment.

    Maximizes total match_score subject to:
      (1) Basic quals covered by exactly 1 bullet (with slack for infeasibility)
      (2) Preferred quals covered by at most 1 bullet
      (3) y[q,b] <= x[b] (select bullet before assigning)
      (4) Each source contributes <= source_cap bullets
      (5) Global bullet cap: total selected <= global_cap
      (6) y[q,b] = 0 if match_score < score_floor
      (7) [if KEYWORD_COVERAGE_ENABLED] For each must-have keyword, at least
          one eligible bullet must be selected (with slack for impossible cases)
    """
    # Keyword coverage setup
    keywords = must_have_keywords or []
    use_keyword_coverage = KEYWORD_COVERAGE_ENABLED and len(keywords) > 0 and bullet_texts is not None

    # Determine effective score floor
    effective_score_floor = score_floor
    if use_keyword_coverage and bullet_texts:
        # Check if any must-have keyword has only below-floor eligible bullets
        for kw in keywords:
            eligible = find_eligible_bullets(bullet_texts, kw)
            if eligible:
                # Check if all eligible bullets for this keyword are below the floor
                # in the candidate lists — if so, lower the floor
                has_above_floor = False
                for qc in ranked:
                    for cand in qc.candidates:
                        if cand.bullet_id in eligible and cand.match_score >= score_floor:
                            has_above_floor = True
                            break
                    if has_above_floor:
                        break
                if not has_above_floor:
                    effective_score_floor = MATCH_SCORE_FLOOR_LOWERED
                    break

    # Build candidate lookups
    qual_candidates: dict[str, list[tuple[str, str, float]]] = {}
    bullet_source: dict[str, str] = {}
    all_bullet_ids: set[str] = set()
    qual_kind_map: dict[str, QualKind] = {}
    qual_category_map: dict[str, QualCategory | None] = {}

    for qc in ranked:
        qid = qc.qualification.id
        qual_kind_map[qid] = qc.qualification.kind
        qual_category_map[qid] = qc.qualification.category
        qual_candidates[qid] = []
        for cand in qc.candidates:
            if cand.match_score >= effective_score_floor:
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

    # Compute keyword eligibility for ILP constraints
    keyword_eligible: dict[str, list[str]] = {}  # canonical -> eligible bullet_ids
    impossible_keywords: list[str] = []
    if use_keyword_coverage and bullet_texts:
        for kw in keywords:
            eligible = find_eligible_bullets(bullet_texts, kw)
            # Filter to only bullets that are in the ILP variable set
            eligible_in_ilp = [bid for bid in eligible if bid in all_bullet_ids]
            if eligible_in_ilp:
                keyword_eligible[kw.canonical] = eligible_in_ilp
            else:
                impossible_keywords.append(kw.canonical)
        if impossible_keywords:
            logger.info("impossible_keywords", keywords=impossible_keywords)

    # Primary solve with basic=exact (slack), preferred=soft, global cap
    result = _solve(
        qual_ids=qual_ids,
        qual_candidates=qual_candidates,
        source_bullets=source_bullets,
        all_bullet_ids=all_bullet_ids,
        bullet_source=bullet_source,
        source_cap=source_cap,
        global_cap=global_cap,
        qual_kind_map=qual_kind_map,
        qual_category_map=qual_category_map,
        keyword_eligible=keyword_eligible if use_keyword_coverage else None,
    )

    if result is None:
        logger.warning(
            "ilp_infeasible_primary",
            qual_count=len(qual_ids),
            source_count=len(source_bullets),
        )
        # Fallback: all soft constraints (keywords still active)
        result = _solve(
            qual_ids=qual_ids,
            qual_candidates=qual_candidates,
            source_bullets=source_bullets,
            all_bullet_ids=all_bullet_ids,
            bullet_source=bullet_source,
            source_cap=source_cap,
            global_cap=global_cap,
            qual_kind_map=qual_kind_map,
            qual_category_map=qual_category_map,
            all_soft=True,
            keyword_eligible=keyword_eligible if use_keyword_coverage else None,
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

    # Also include bullets selected for keyword coverage (x=1) but not assigned to any qual
    if use_keyword_coverage:
        for bid, x_val in selected_x.items():
            if x_val > 0.5 and bid not in bullet_to_quals:
                # This bullet was selected for keyword coverage only
                bullet_to_quals[bid] = []  # no qual assignment, but selected

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

    # Determine uncovered keywords (keywords where no selected bullet carries them)
    uncovered_kw: list[str] = []
    if use_keyword_coverage and bullet_texts:
        selected_bids = {sb.bullet_id for sb in selected_bullets}
        for kw_canonical, eligible_bids in keyword_eligible.items():
            if not any(bid in selected_bids for bid in eligible_bids):
                uncovered_kw.append(kw_canonical)

    fs = FinalSelection(
        selected_bullets=selected_bullets,
        uncovered_qualifications=uncovered,
        uncovered_keywords=uncovered_kw,
        impossible_keywords=impossible_keywords if use_keyword_coverage else [],
        total_score=round(total_score, 1),
        source_utilization=dict(source_util),
    )

    logger.info(
        "ilp_solved",
        total_score=fs.total_score,
        selected_count=len(fs.selected_bullets),
        uncovered_count=len(fs.uncovered_qualifications),
        uncovered_keywords=len(fs.uncovered_keywords),
        impossible_keywords=len(fs.impossible_keywords),
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
    global_cap: int,
    qual_kind_map: dict[str, QualKind],
    qual_category_map: dict[str, QualCategory | None],
    all_soft: bool = False,
    keyword_eligible: dict[str, list[str]] | None = None,
) -> tuple[dict[str, float], dict[tuple[str, str], float], float] | None:
    """Internal ILP solver. Returns (x_values, y_values, total_score) or None."""

    prob = LpProblem("bullet_assignment", LpMaximize)

    # Variables
    x = {b: LpVariable(f"x_{b}", cat=LpBinary) for b in all_bullet_ids}
    y: dict[tuple[str, str], LpVariable] = {}
    for qid, cands in qual_candidates.items():
        for bid, sid, score in cands:
            y[(qid, bid)] = LpVariable(f"y_{qid}_{bid}", cat=LpBinary)

    # Slack variables for basic quals (allow infeasibility with heavy penalty)
    slack: dict[str, LpVariable] = {}
    if not all_soft:
        for qid in qual_ids:
            if qual_kind_map.get(qid) == QualKind.basic:
                slack[qid] = LpVariable(f"slack_{qid}", cat=LpBinary)

    # Objective: maximize total match_score + tiebreaker - slack penalties
    obj_terms = []
    for (qid, bid), var in y.items():
        score = _get_score(qual_candidates, qid, bid)
        # Scale down values_statement quals
        if qual_category_map.get(qid) == QualCategory.values_statement:
            score *= VALUES_QUAL_SCORE_SCALE
        obj_terms.append(score * var)

    # Tiebreaker: deterministic by bullet_id hash
    for bid, var in x.items():
        h = int(hashlib.md5(bid.encode()).hexdigest()[:8], 16)
        obj_terms.append(1e-6 * (-h / (2**32)) * var)

    # Slack penalties
    for qid, s_var in slack.items():
        obj_terms.append(-1000.0 * s_var)

    # Keyword coverage slack variables (Phase 4)
    slack_kw: dict[str, LpVariable] = {}
    if keyword_eligible:
        for kw_canonical, eligible_bids in keyword_eligible.items():
            eligible_in_x = [bid for bid in eligible_bids if bid in x]
            if eligible_in_x:
                slack_kw[kw_canonical] = LpVariable(f"slack_kw_{kw_canonical[:20]}", cat=LpBinary)
                obj_terms.append(-KEYWORD_SLACK_PENALTY * slack_kw[kw_canonical])

    prob += lpSum(obj_terms)

    # Constraint (1)/(2): coverage
    for qid in qual_ids:
        cand_vars = [y[(qid, bid)] for bid, sid, s in qual_candidates.get(qid, [])
                     if (qid, bid) in y]
        if not cand_vars:
            continue

        if all_soft:
            prob += lpSum(cand_vars) <= 1, f"cover_{qid}"
        elif qual_kind_map.get(qid) == QualKind.basic:
            # Basic: must cover (with slack for infeasibility)
            prob += lpSum(cand_vars) + slack[qid] >= 1, f"cover_min_{qid}"
            prob += lpSum(cand_vars) <= 1, f"cover_max_{qid}"
        else:
            # Preferred: soft cover
            prob += lpSum(cand_vars) <= 1, f"cover_{qid}"

    # Constraint (3): y[q,b] <= x[b]
    for (qid, bid), var in y.items():
        prob += var <= x[bid], f"select_{qid}_{bid}"

    # Constraint (4): source cap
    for sid, bids in source_bullets.items():
        source_vars = [x[bid] for bid in bids if bid in x]
        if source_vars:
            prob += lpSum(source_vars) <= source_cap, f"cap_{sid}"

    # Constraint (5): global bullet cap
    if all_bullet_ids:
        prob += lpSum(x[bid] for bid in all_bullet_ids) <= global_cap, "global_cap"

    # Constraint (7): keyword coverage (Phase 4)
    # For each must-have keyword with eligible bullets in the ILP,
    # at least one eligible bullet must be selected (with slack penalty).
    if keyword_eligible and slack_kw:
        for kw_canonical, eligible_bids in keyword_eligible.items():
            if kw_canonical not in slack_kw:
                continue
            eligible_in_x = [bid for bid in eligible_bids if bid in x]
            if eligible_in_x:
                prob += (
                    lpSum(x[bid] for bid in eligible_in_x) + slack_kw[kw_canonical] >= 1,
                    f"kw_cover_{kw_canonical[:30]}",
                )

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

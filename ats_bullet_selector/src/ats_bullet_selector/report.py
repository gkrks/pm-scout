"""Stage E: report generation. Writes ranked_candidates.json, final_selection.json, report.md."""

from __future__ import annotations

import json
from pathlib import Path

import structlog

from .config import OUTPUTS_DIR
from .models import FinalSelection, QualCandidates

logger = structlog.get_logger()


def generate_report(
    job_id: str,
    ranked: list[QualCandidates],
    selection: FinalSelection,
) -> Path:
    """Write Stage E outputs to outputs/<job_id>/. Returns the output directory."""
    out_dir = OUTPUTS_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    # ranked_candidates.json
    rc_path = out_dir / "ranked_candidates.json"
    rc_data = [qc.model_dump(mode="json") for qc in ranked]
    rc_path.write_text(json.dumps(rc_data, indent=2), encoding="utf-8")

    # final_selection.json
    fs_path = out_dir / "final_selection.json"
    fs_path.write_text(selection.model_dump_json(indent=2), encoding="utf-8")

    # report.md
    md_path = out_dir / "report.md"
    md_path.write_text(_build_markdown(ranked, selection), encoding="utf-8")

    logger.info("report_generated", job_id=job_id, path=str(out_dir))
    return out_dir


def _build_markdown(
    ranked: list[QualCandidates],
    selection: FinalSelection,
) -> str:
    """Build a human-readable markdown report."""
    lines: list[str] = []
    lines.append("# Bullet Selection Report\n")
    lines.append(f"**Total score:** {selection.total_score}\n")
    lines.append(f"**Selected bullets:** {len(selection.selected_bullets)}\n")

    if selection.uncovered_qualifications:
        lines.append(
            f"**Uncovered qualifications:** "
            f"{', '.join(selection.uncovered_qualifications)}\n"
        )

    lines.append("\n## Source Utilization\n")
    for src, count in sorted(selection.source_utilization.items()):
        lines.append(f"- {src}: {count} bullet(s)\n")

    # Build lookup: bullet_id -> list of qual_ids it covers
    bullet_covers: dict[str, list[str]] = {}
    for sb in selection.selected_bullets:
        bullet_covers[sb.bullet_id] = sb.covers_qualifications

    lines.append("\n## Per-Qualification Breakdown\n")
    for qc in ranked:
        q = qc.qualification
        lines.append(f"### {q.id} ({q.kind.value})\n")
        lines.append(f"> {q.text}\n\n")

        for i, cand in enumerate(qc.candidates[:3], 1):
            is_selected = cand.bullet_id in bullet_covers
            badge = " **[SELECTED]**" if is_selected else ""
            lines.append(f"**#{i}{badge}** (score: {cand.match_score}, "
                         f"confidence: {cand.confidence})\n")
            lines.append(f"- Source: {cand.source_label}\n")
            lines.append(f"- Text: {cand.text}\n")
            lines.append(f"- Rationale: {cand.rationale}\n")
            lines.append(f"- Sub-scores: kw={cand.sub_scores.keyword} "
                         f"sem={cand.sub_scores.semantic} "
                         f"evi={cand.sub_scores.evidence} "
                         f"qty={cand.sub_scores.quantification} "
                         f"sen={cand.sub_scores.seniority} "
                         f"rec={cand.sub_scores.recency}\n\n")

    return "".join(lines)

"""Validation harness for embedding quality measurement.

Compares the top-3 bullet rankings from a given embedding provider against
a labeled dataset of (qualification, expected_top_3) triples.

Usage:
    python -m ats_bullet_selector.scripts.validate \
        --provider voyage \
        --triples tests/validation/triples.jsonl \
        --runs 1

Metrics reported:
  - Top-3 set membership accuracy (mean fraction of expected IDs in returned top 3)
  - Top-3 ordering stability (Kendall's tau between consecutive runs on same input)
  - Map hit rate (fraction served from precomputed map vs re-rank)
  - Per-stage latency p50/p95

Output:
  - Console summary
  - docs/validation_report.md (appended/updated)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import structlog

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ats_bullet_selector.config import OUTPUTS_DIR
from ats_bullet_selector.db import load_master_resume
from ats_bullet_selector.models import Qualification, QualKind

logger = structlog.get_logger()


def _load_triples(path: str) -> list[dict]:
    """Load validation triples from JSONL file."""
    triples = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                triples.append(json.loads(line))
    return triples


def _top3_set_membership(expected: list[str], actual: list[str]) -> float:
    """Fraction of expected IDs present in actual top 3."""
    if not expected:
        return 1.0
    expected_set = set(expected[:3])
    actual_set = set(actual[:3])
    return len(expected_set & actual_set) / len(expected_set)


def _kendall_tau(ranking_a: list[str], ranking_b: list[str]) -> float:
    """Simplified Kendall's tau for top-3 rankings.
    Returns 1.0 for identical ordering, lower for disagreements."""
    if ranking_a == ranking_b:
        return 1.0
    # Count concordant pairs
    common = set(ranking_a[:3]) & set(ranking_b[:3])
    if len(common) < 2:
        return 0.0
    concordant = 0
    discordant = 0
    items = list(common)
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a_order = ranking_a.index(items[i]) < ranking_a.index(items[j])
            b_order = ranking_b.index(items[i]) < ranking_b.index(items[j])
            if a_order == b_order:
                concordant += 1
            else:
                discordant += 1
    total = concordant + discordant
    if total == 0:
        return 1.0
    return (concordant - discordant) / total


def run_validation(provider: str, triples_path: str, num_runs: int = 1):
    """Run the validation harness."""
    # Set provider — must patch both env and the already-imported config module
    os.environ["EMBEDDER_PROVIDER"] = provider
    import ats_bullet_selector.config as cfg
    cfg.EMBEDDER_PROVIDER = provider

    # Also patch map_lookup's imported reference
    import ats_bullet_selector.map_lookup as ml
    ml.EMBEDDER_PROVIDER = provider

    # Load data
    triples = _load_triples(triples_path)
    bullets = load_master_resume()
    bullet_map = {b.bullet_id: b for b in bullets}

    logger.info("validation_start", provider=provider, triples=len(triples), runs=num_runs)

    # Import ranking function
    from ats_bullet_selector.map_lookup import rank_all_from_map

    # Track metrics across runs
    all_accuracies: list[float] = []
    all_latencies: list[float] = []
    run_rankings: list[dict[str, list[str]]] = []  # per-run: {qual_text: [top3 ids]}

    for run_idx in range(num_runs):
        # Clear embedding caches between runs for stability measurement
        import ats_bullet_selector.map_lookup as ml
        ml._bullet_embeddings = None
        ml._bullet_ids_order = None

        run_start = time.time()
        rankings: dict[str, list[str]] = {}

        for triple in triples:
            qual_text = triple["qualification"]
            expected = triple["expected_top_3"]

            qual = Qualification(id=f"val_{hash(qual_text) % 10000}", kind=QualKind.basic, text=qual_text)

            t0 = time.time()
            results = rank_all_from_map([qual], bullets, top_k=3)
            latency_ms = (time.time() - t0) * 1000
            all_latencies.append(latency_ms)

            if results and results[0].candidates:
                actual_ids = [c.bullet_id for c in results[0].candidates[:3]]
            else:
                actual_ids = []

            rankings[qual_text] = actual_ids
            accuracy = _top3_set_membership(expected, actual_ids)
            all_accuracies.append(accuracy)

        run_rankings.append(rankings)
        run_duration = time.time() - run_start
        logger.info(f"run_{run_idx + 1}_complete", duration_s=round(run_duration, 1))

    # Compute aggregate metrics
    mean_accuracy = np.mean(all_accuracies) if all_accuracies else 0.0
    p50_latency = np.percentile(all_latencies, 50) if all_latencies else 0.0
    p95_latency = np.percentile(all_latencies, 95) if all_latencies else 0.0

    # Compute ordering stability (Kendall's tau between runs)
    tau_values: list[float] = []
    if num_runs >= 2:
        for i in range(num_runs - 1):
            for qual_text in run_rankings[0].keys():
                if qual_text in run_rankings[i] and qual_text in run_rankings[i + 1]:
                    tau = _kendall_tau(run_rankings[i][qual_text], run_rankings[i + 1][qual_text])
                    tau_values.append(tau)
    mean_tau = np.mean(tau_values) if tau_values else 1.0

    # Per-category breakdown
    category_accuracies: dict[str, list[float]] = {"easy": [], "transferable": [], "near_miss": []}
    for i, triple in enumerate(triples):
        cat = triple.get("category", "unknown")
        if cat in category_accuracies and i < len(all_accuracies):
            category_accuracies[cat].append(all_accuracies[i])

    # Report
    report = f"""# Validation Report — {provider}

**Date:** {time.strftime('%Y-%m-%d %H:%M')}
**Provider:** `{provider}`
**Triples:** {len(triples)}
**Runs:** {num_runs}

## Metrics

| Metric | Value |
|--------|-------|
| **Top-3 set membership accuracy** | {mean_accuracy:.3f} |
| **Top-3 ordering stability (Kendall's tau)** | {mean_tau:.3f} |
| **Latency p50** | {p50_latency:.0f} ms |
| **Latency p95** | {p95_latency:.0f} ms |

## Per-Category Accuracy

| Category | Count | Mean Accuracy |
|----------|-------|---------------|
| Easy | {len(category_accuracies['easy'])} | {np.mean(category_accuracies['easy']):.3f} |
| Transferable | {len(category_accuracies['transferable'])} | {np.mean(category_accuracies['transferable']):.3f} |
| Near-miss | {len(category_accuracies['near_miss'])} | {np.mean(category_accuracies['near_miss']):.3f} |

## Per-Triple Results

| # | Category | Qual (truncated) | Accuracy | Top-3 Returned |
|---|----------|-------------------|----------|----------------|
"""
    for i, triple in enumerate(triples):
        qual_short = triple["qualification"][:50]
        actual = run_rankings[-1].get(triple["qualification"], []) if run_rankings else []
        acc = all_accuracies[i] if i < len(all_accuracies) else 0.0
        report += f"| {i+1} | {triple.get('category', '?')} | {qual_short} | {acc:.2f} | {', '.join(actual[:3])} |\n"

    report += f"""
## Notes

- Accuracy = fraction of expected top-3 IDs present in returned top-3 (order-agnostic).
- Kendall's tau measures ordering stability between consecutive runs (1.0 = identical).
- If accuracy < 0.67 on easy triples, investigate embedding quality.
- Near-miss triples have inherently ambiguous rankings; accuracy < 0.5 is acceptable.
"""

    # Write report
    docs_dir = Path(__file__).resolve().parents[4] / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    report_path = docs_dir / "validation_report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    # Console summary
    print("\n" + "=" * 60)
    print(f"  VALIDATION COMPLETE — {provider}")
    print("=" * 60)
    print(f"  Top-3 set membership accuracy: {mean_accuracy:.3f}")
    print(f"  Ordering stability (tau):      {mean_tau:.3f}")
    print(f"  Latency p50/p95:               {p50_latency:.0f}ms / {p95_latency:.0f}ms")
    print(f"  Report written to:             {report_path}")
    print("=" * 60 + "\n")

    return mean_accuracy


def main():
    parser = argparse.ArgumentParser(description="Validate embedding quality against labeled triples.")
    parser.add_argument("--provider", choices=["voyage", "openai"], required=True)
    parser.add_argument("--triples", required=True, help="Path to JSONL validation triples file")
    parser.add_argument("--runs", type=int, default=1, help="Number of runs for stability measurement")
    args = parser.parse_args()

    run_validation(args.provider, args.triples, args.runs)


if __name__ == "__main__":
    main()

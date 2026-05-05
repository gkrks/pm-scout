# Validation Dataset — Embedding Quality

## File: `triples.jsonl`

30 labeled `(qualification, expected_top_3_bullet_ids)` tuples for measuring
embedding quality before and after the Voyage migration.

### Categories

| Category | Count | Description |
|----------|-------|-------------|
| **easy** | 10 | The right bullet is obvious to a human grader |
| **transferable** | 10 | Pure embedding misses the connection; transferable skill reasoning needed |
| **near_miss** | 10 | Two bullets are plausible and ordering matters |

### Format

Each line is a JSON object:
```json
{
  "qualification": "3+ years experience in a product management role",
  "expected_top_3": ["exp_saayam_1_a1b2", "exp_saayam_1_b3c4", "exp_matic_0_c9d3"],
  "category": "easy",
  "notes": "Direct PM experience match"
}
```

### How to label

1. Read the qualification text
2. Review all 73 master resume bullets (run: `python -c "from src.ats_bullet_selector.db import load_master_resume; [print(f'{b.bullet_id}: {b.text[:100]}') for b in load_master_resume()]"`)
3. Pick the 3 best-matching bullets in ranked order
4. Assign a category (easy/transferable/near_miss)
5. Write a short note explaining your reasoning

### How to run validation

```bash
cd ats_bullet_selector

# Against current OpenAI embeddings (baseline)
.venv/bin/python -m ats_bullet_selector.scripts.validate \
  --provider openai \
  --triples tests/validation/triples.jsonl \
  --runs 3

# Against Voyage (requires VOYAGE_API_KEY)
.venv/bin/python -m ats_bullet_selector.scripts.validate \
  --provider voyage \
  --triples tests/validation/triples.jsonl \
  --runs 3
```

### Acceptance criteria

- **Voyage must achieve >= parity** with OpenAI on top-3 set membership accuracy
- If Voyage underperforms: rollback, document in `docs/validation_report.md`
- Minimum thresholds:
  - Easy triples: accuracy >= 0.67
  - Transferable triples: accuracy >= 0.45
  - Near-miss triples: any accuracy acceptable (inherently ambiguous)

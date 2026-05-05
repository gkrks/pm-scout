# Refactor Decisions — Recorded 2026-05-05

All 19 clarifying questions from the implementation brief have been answered. This document is the canonical record of those decisions.

## Decisions Summary

1. **VOYAGE_API_KEY**: User is provisioning; will be available by implementation complete.
2. **Spend cap**: TBD by user.
3. **Embedding dimensions**: `output_dimension=1024`.
4. **Output dtype**: `"float"` (binary optimization deferred to later iteration).
5. **Migration strategy**: Archive existing map to `outputs/qualification_map.openai.archived.json`; regenerate fresh on voyage-context-3. Both maps coexist during validation; flag selects active provider.
6. **Validation set**: User will manually label 30 triples before Phase 6.
7. **Master resume source of truth**: Supabase (local JSON is a synced copy).
8. **Role families**: `pm` (populated), `pa` (stub), `swe` (stub), `tpm` (stub), `data_analyst` (stub), `program_manager` (stub), `engineering_manager` (stub).
9. **Default fallback role**: `pm`.
10. **Role detection**: Auto-detect from JD title + user-overridable in the UI.
11. **Acronym policy — keep_as_acronym**: Confirmed default list + JD-aware override (if JD uses expanded form, mirror it in output even for terms normally kept as acronym).
12. **Acronym policy — always_spell_out**: Confirmed default list, no changes.
13. **Ambiguous terms**: User decides case-by-case during taxonomy population.
14. **Keyword coverage feature flag**: Yes, behind `KEYWORD_COVERAGE_ENABLED` (default false).
15. **Rewriter activation**: Behind explicit UI toggle ("Optimize bullets for this JD"), not automatic.
16. **Rewriter cost control**: Limit rewriter to top 3 selected bullets only per request.
17. **Rewrite caching**: Yes, by `(bullet_id, jd_hash)`.
18. **Voyage underperformance**: Rollback to OpenAI, document results.
19. **Logging destination**: stdout.

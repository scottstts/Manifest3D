# Phase 4 Agent Design Choices

This captures the Phase 4 repair feedback, prompt compiler, candidate history, and freshness decisions that are not obvious from individual files.

## Prompt Sources

Prompt text is stored as separate markdown files under `src/engine/agent/prompts/` and imported by `promptCompiler.ts` with Vite raw imports. Long prompt strings should not be embedded in `agentLoop.ts`, provider clients, or tests.

The prompt files are Manifest3D-specific, but they intentionally carry the relevant Articraft designer prompt lessons:

- realistic geometry is the primary quality bar
- use real-world scale and plausible materials
- articulate primary visible mechanisms and controls
- avoid floating parts and unsupported visual islands
- classify overlap as intentional or unintended before repairing it
- pair intentional overlap allowances with exact proof checks
- treat validation output as sensor data, not as permission to simplify the requested object
- use concise stable semantic ids and avoid state words like `open`, `closed`, or `extended`

Do not port Articraft's Python/tool instructions into these prompts. Manifest3D agents return strict JSON assets, not editable Python code.

## Prompt Compiler Contract

`compileManifestPrompt` returns separate `system` and `user` strings plus small metadata. It composes:

- system identity and quality bar
- compact Contract V2 schema guidance
- mode-specific create, edit, or repair instructions
- current scene summary
- selected asset JSON for edit mode
- compact/minified candidate JSON for repair mode
- image attachment metadata
- prior validation feedback
- compact examples

Edit mode requires a selected asset and returns the full revised asset JSON, not a patch. Repair mode includes the failed candidate and `<validation_signals>` feedback. The failed candidate is still complete, but it is minified in repair turns because real headless runs showed pretty-printed candidate JSON was the dominant context cost after signal compaction.

## Candidate History And Freshness

`candidateHistory.ts` is intentionally pure TypeScript and independent from React. It tracks an active run id, candidate revisions, candidate fingerprints, validation attempts, the latest successful attempt, and repeated failure signatures.

The readiness rule is fingerprint-based:

```text
The agent can report ready only when the active candidate fingerprint matches the latest successful validation attempt.
```

Calling `markCandidateDraft` after a successful validation clears freshness because the active fingerprint changes. Failed candidates stay in history and are not committed to the scene.

Fingerprints use stable serialization so object key order does not change candidate identity. Failure signatures are derived from failure signals, not from whole reports, so repeated-failure detection focuses on validation behavior rather than report ids or timeline metadata.

## Repair Feedback

`repairFeedback.ts` renders model-facing `<validation_signals>` blocks from `ValidationSignalBundle`:

```text
<validation_signals>
<summary>...</summary>
<repair_context>...</repair_context>
<failures>...</failures>
<warnings>...</warnings>
<notes>...</notes>
<response_rules>...</response_rules>
</validation_signals>
```

Signals remain the source of truth. The rendered feedback is a deterministic projection for the next model turn.

Failure ordering is deliberate:

1. schema
2. structure and joint tree
3. build/runtime
4. baseline QC
5. authored checks
6. export

This keeps the model from tuning local geometry before JSON shape, ids, refs, roots, cycles, and joint semantics are valid.

Repair rules are chosen from the primary failure kind. Schema failures tell the model to fix JSON first. Structural failures emphasize stable ids, refs, roots, and joint graph validity. Floating and overlap failures require either a physical fix or scoped allowances with concrete reasons. Missing exact geometry is treated as a stable-id contract failure.

Repeated failures and failure streaks are included in the feedback summary so Phase 5 can feed them back into repair turns.

Repair feedback also injects the candidate revision and fingerprint. This mirrors the Articraft freshness invariant: the validation evidence belongs to exactly one candidate revision, any mutation requires fresh validation, and the model should make the smallest focused repair while preserving unrelated stable ids.

## Timeline Projection

`validationTimeline.ts` still supports timeline rows from one validation report, and now also supports candidate-history projection. Candidate-attempt rows summarize revision, fingerprint, and repeated-failure streak before the per-stage validation rows.

The timeline is not the validation model. Future UI should continue deriving rows from candidate history and validation reports rather than mutating timeline state directly.

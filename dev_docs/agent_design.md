# Phase 4 Agent Design Choices

This captures the Phase 4 repair feedback, prompt compiler, candidate history, and freshness decisions that are not obvious from individual files.

## Prompt Sources

Prompt text is stored as separate markdown files under `src/engine/agent/prompts/` and imported by `promptCompiler.ts` with Vite raw imports. Long prompt strings should not be embedded in `agentLoop.ts`, provider clients, or tests.

The prompt files are Manifest3D-specific, but they intentionally carry the relevant Articraft designer prompt lessons:

- realistic geometry is the primary quality bar
- use real-world scale and plausible materials
- prefer `roundedBox` and `capsule` where manufactured objects need softened panels, handles, rails, padded supports, rounded pins, or grips
- articulate primary visible mechanisms and controls
- use material `emission` and `emissionAnimation` for visible lights, flashing beacons, LEDs, screens, and color-switching indicators
- choose material `side` deliberately and add `expect_material_side` for prompt-critical open/cutaway surfaces
- give multi-joint mechanisms clear `controls` coverage instead of leaving unrelated movable joints as orphan dials
- avoid floating parts and unsupported visual islands
- classify overlap as intentional or unintended before repairing it
- pair intentional overlap allowances with exact proof checks
- keep `roundedBox` radius within the primitive contract instead of spending a repair turn on impossible corner radii
- keep visuals inside a part physically continuous, or split separate mounted islands into fixed child parts
- preserve real clearance for moving rotors, blades, wheels, hinges, and sliders inside stationary guards, grilles, cages, rails, and shrouds
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

Image attachments are passed through the same prompt compiler metadata and provider request path as the app. The headless harness can now load local reference image files for stress runs, but that support is contained in `test/headless/agentPipelineSmoke.test.ts`; the app-side agent client still receives ordinary image attachment payloads.

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

Two common structural repair loops have targeted rules:

- `rounded_box_radius_too_large` tells the model to reduce the radius below half of the shortest size component or adjust the size while preserving softened manufactured form.
- `allowance_overlap_missing_proof_check` tells the model that every intentional overlap allowance needs a matching exact proof check, and visual-scoped allowances need the same visual pair in that proof.

Repeated failures and failure streaks are included in the feedback summary so Phase 5 can feed them back into repair turns.

Repair feedback also injects the candidate revision and fingerprint. This mirrors the Articraft freshness invariant: the validation evidence belongs to exactly one candidate revision, any mutation requires fresh validation, and the model should make the smallest focused repair while preserving unrelated stable ids.

## Headless Stress Harness

`test/headless/agentPipelineSmoke.test.ts` is the practical pipeline stress harness. It exercises the same embedded engine and agent loop headlessly, then records candidate JSON, validation reports, request/response exchanges, and GLB artifacts for visual inspection.

The headless harness deliberately bends around the app rather than the app bending around the test. Test-only conveniences such as Node file shims, local reference-image loading, artifact directory writing, per-attempt GLB materialization, and viewer URL generation live in the test harness. App source should change only for real engine, validation, export, or prompt quality improvements that also matter to interactive runs.

Provider requests should go through the imported app provider client factory instead of a headless-only reimplementation of the transport or provider switch. The harness may wrap the client to record prompt and response artifacts, but it should not recreate OpenAI/Gemini request plumbing that already exists in `src/`. `HEADLESS_AGENT_PROVIDER` selects the provider for a run and defaults to OpenAI.

OpenAI uses Responses API background mode by default in `openAiManifestClient.ts`: requests set `background: true` and `store: true`, then poll the response id until it reaches a terminal status. This avoids one long idle HTTP response for high-reasoning, strict-schema asset generations and is shared by the app and headless harness. The tradeoff is that background polling is not ZDR-compatible, so do not silently change it back to `store: false` without replacing the long-running transport strategy.

Current headless stress behavior:

- the default run budget is one hour
- ready candidates export static GLB artifacts
- assets with movable joints or material emission animation also export dynamic GLB artifacts when animation export is supported
- every schema-parseable attempt gets its own static and, when applicable, dynamic GLB export under that attempt's artifact directory so validation pressure can be compared against visual quality over repair turns
- local reference images can be supplied through `HEADLESS_AGENT_IMAGE_PATH` or `HEADLESS_AGENT_IMAGE_PATHS`
- default artifacts live under `test/headless/artifacts/headless-agent/` so `test/headless/glb_viewer.html` can serve them directly from a simple local HTTP server
- summary JSON records exported GLB paths and viewer URLs

## Timeline Projection

`validationTimeline.ts` still supports timeline rows from one validation report, and now also supports candidate-history projection. Candidate-attempt rows summarize revision, fingerprint, and repeated-failure streak before the per-stage validation rows.

The timeline is not the validation model. Future UI should continue deriving rows from candidate history and validation reports rather than mutating timeline state directly.

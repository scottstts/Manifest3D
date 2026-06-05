# Agent Design

This document describes the implemented Manifest3D agent pipeline: prompt compilation, provider boundaries, candidate freshness, repair feedback, persistence context, and headless stress runs.

## Prompt Sources

Prompt text lives under `src/engine/agent/prompts/` and is imported by `promptCompiler.ts` through Vite raw imports. Long prompt strings should stay out of `agentLoop.ts`, provider clients, UI code, and tests.

The prompt contract emphasizes:

- realistic geometry as the primary quality bar
- real-world scale and plausible materials
- softened manufactured forms through `roundedBox` and `capsule`
- explicit articulation for primary visible mechanisms and controls
- CAD-like fitted interfaces for mechanical cutaways, engines, gearboxes, pumps, vehicles, tools, and other precision assemblies
- material `emission` and `emissionAnimation` for visible lights, LEDs, screens, and flashing or color-changing indicators
- deliberate material `side` selection, with `expect_material_side` checks for prompt-critical open or cutaway surfaces
- `controls` coverage for multi-joint mechanisms
- physically supported parts, with no unsupported visual islands
- visibly seated blade roots for fans, compressors, turbines, propellers, and other rotating blade assemblies
- exact bounded fitted-contact proof for seated visual pairs, plus scoped intentional overlap allowances paired with exact proof checks for other exceptions
- exact contact, bounded-gap, containment, or bounded-penetration checks for prompt-critical mechanical fits
- valid primitive parameters, including `roundedBox.radius <= min(size) / 2`
- stable semantic ids that avoid state words such as `open`, `closed`, or `extended`
- validation output treated as sensor data, not permission to simplify the requested object

Manifest3D agents return strict JSON assets for create turns and compact patch tool objects for edit/repair turns. They do not emit code.

## Prompt Compiler Contract

`compileManifestPrompt` returns separate `system` and `user` strings plus compact metadata. It composes the system identity, Contract V2 schema guidance, mode-specific create/edit/repair instructions, current scene summary, selected asset JSON for edit mode, compact candidate JSON for repair mode, image attachment metadata, prior validation feedback, and mode-appropriate examples. Create prompts use full asset examples; edit and repair prompts use compact patch tool examples only.

Create mode expects the response root to be the complete Manifest3D asset, without `tool`, `asset`, `argumentsJson`, or other wrappers. Edit mode requires a selected asset and returns an `apply_manifest_patch` tool object with direct `operations`. Repair mode includes the failed candidate and `<validation_signals>` feedback, and also expects that same patch tool object. The failed candidate remains complete and is minified in repair prompts to reduce context cost when client-side candidate replay is needed.

Image attachments flow through the same prompt compiler metadata and provider request path as ordinary app runs. The headless harness can load local reference image files for stress tests, but that filesystem convenience stays in `test/headless/agentPipelineSmoke.test.ts`.

## Provider Boundary

Provider-specific transport details belong inside provider clients. UI, scene, and persistence code talk through the agent loop and shared provider client interfaces.

OpenAI is the starting provider default. The last provider selected in the Providers panel is cached as the next default. Per-provider Model ID and Reasoning Effort preferences are cached in localStorage and default from `modelConfig.ts`; OpenAI maps reasoning effort to `reasoning.effort` with `none`/`low`/`medium`/`high`/`xhigh`, while Gemini maps it to `thinkingConfig.thinkingLevel` with `minimal`/`low`/`medium`/`high`. API keys are never persisted outside local `.env` or the current browser session.

Localhost and loopback runs load provider keys only through the dev-server `.env` endpoint. The top-bar status dot is green when at least one local provider key is available. Non-localhost runs use in-memory per-provider keys from the Providers panel, and readiness reflects the currently selected provider.

OpenAI uses Responses API background mode in `openAiManifestClient.ts`: requests set `background: true` and `store: true`, then poll the response id until terminal status. This avoids one long idle HTTP response for high-reasoning strict-schema generations. The tradeoff is that background polling is not ZDR-compatible, so changing it requires a replacement long-running transport strategy.

Repair/edit mode uses a shared compact patch tool schema across providers: `{ "tool": "apply_manifest_patch", "operations": [{ "op", "path", "valueJson" }] }`. The harness parses each add/replace `valueJson` into canonical `{ value: unknown }` JSON Patch operations before applying the patch. This avoids the old double-encoded outer `argumentsJson` envelope while still keeping arbitrary patch values out of the provider response schema.

## Candidate History And Freshness

`candidateHistory.ts` is pure TypeScript and independent from React. It tracks an active run id, candidate revisions, stable fingerprints, validation attempts, the latest successful attempt, and repeated failure signatures.

The readiness invariant is fingerprint-based:

```text
The agent can report ready only when the active candidate fingerprint matches the latest successful validation attempt.
```

Calling `markCandidateDraft` after successful validation clears freshness because the active fingerprint changes. Failed candidates remain in history and are not committed to the scene.

Fingerprints use stable serialization so object key order does not change candidate identity. Failure signatures come from semantic failure clusters rather than whole reports or raw measurements. They normalize by stage, kind, code, unordered part pair or stable ref, and sampled-pose key while ignoring incidental details such as depth, volume, report ids, and visual-level noise.

Each app run owns its own `CandidateHistory`. `runManifestAgentLoop` emits progress snapshots containing upserted agent events, the matching history snapshot, and projected timeline items.

## Repair Patches

Repair/edit turns return `{ "tool": "apply_manifest_patch", "operations": [...] }`. The harness normalizes those operations to canonical `{ "patch": [...] }`, applies the patch to a cloned candidate, validates the fully patched asset against the Manifest3D schema, and only then accepts it as the next candidate. Patch application errors are fed into the next repair prompt without mutating the candidate. Ordinary repair prompts steer away from root replacement and full-asset output so repair turns stay patch-sized.

Repair patches may address existing array entries by stable id through virtual JSON Pointer segments such as `/parts/byId/deck-truss/visuals/byId/deck-panel/transform/position`. The harness resolves those ids against the current candidate before applying ordinary JSON Patch semantics, which reduces stale array-index failures.

The repair response schema permits focused numeric vectors and point arrays. It avoids unconstrained empty array patch values because `[]` can satisfy many typed array branches while producing schema-invalid assets.

Repeated identical patch-application errors are tracked. The next repair prompt includes the streak, a compact rejected-operation summary, and targeted path hints for common mismatches such as writing `position`, `rotation`, or `scale` inside `joint.limits` instead of `joint.origin`, or placing an authored check object inside a visual `geometry` field instead of patching `/checks`. Geometry-domain hints should also fire from the schema error path alone when a compact rejected-operation summary hides the bad operation. Repair instructions also state the same schema-domain rule before any error occurs.

Patch-application feedback also includes `<repair_target_validation_context>` for the most recent validation attempt. This keeps the original failed candidate revision, fingerprint, failure clusters, and primary failures visible after a rejected patch. Without that context, a repair run can oscillate between schema-only patch correction and the original geometry/QC failure.

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

Signals remain the source of truth. The rendered block is a deterministic projection for the next model turn.

Failure ordering is deliberate:

1. schema
2. structure and joint tree
3. build/runtime
4. baseline QC
5. authored checks
6. sampled-pose QC
7. renderer-facing material-side hygiene
8. export

Schema failures tell the model to fix JSON first. Structural failures emphasize stable ids, references, roots, and joint graph validity. Floating, mechanical-fit, and overlap failures require either a physical fit/support fix, exact bounded fitted-contact proof for intentional seated visual pairs, or scoped allowances with exact proof for other intentional exceptions. Missing exact geometry is treated as a stable-id contract failure.

`surface_side_missing_check` is structurally reported because it proves a visual/material contract, but repair feedback ranks it after physical relation failures when both are present. That keeps open/cutaway material hygiene visible without delaying collision, support, sampled-pose, or mechanical-fit repair.

`mechanical_relation_coverage` is also structurally reported, but its feedback must stay mechanical-specific rather than falling through to generic id/root/joint repair instructions. Missing path/coupler parts, weak path evidence, broad multi-visual coupler checks, wrong relation targets, missing fitted-interface checks, missing guided prismatic joints, missing linked guided/rotary controls, missing pose-specific relation evidence for linked motion, and missing linked multi-joint controls should tell the model to add named components, exact relation evidence, and the needed motion graph. Otherwise repairs tend to move decorative parts around, satisfy checks against arbitrary neighbors, or delete requested mechanisms instead of making CAD-like assemblies visually plausible.

Like material-side hygiene, `mechanical_relation_coverage` is build-permissive. The failure still blocks acceptance, but downstream geometry, QC, authored-check, sampled-pose, and export-readiness stages should run so the first repair sees missing evidence and physical defects together instead of discovering collisions one turn later.

Targeted repair rules cover recurring loops, including oversized `roundedBox.radius`, missing overlap proof checks, sampled-pose overlap repair, no-op controls, loose mechanical joint fits, relation oscillation, and repeated rejected patch operations.

Repair feedback includes candidate revision and fingerprint so the model sees that validation evidence belongs to one exact candidate revision. It can also include `<failure_clusters>` and `<probe_report>` sections. Probe reports contain deterministic geometry measurements such as asset bounds, part bounds, joint-origin distances, connector endpoint measurements, closest visual pair, distance, penetration depth, and overlap volume. They are geometry sensor data, not rendered-image critique.

`<response_rules>` can choose a dominant repeated physical failure cluster as the primary repair target even when the first rendered failure is a singleton floating/detail issue. Hard blockers such as schema, build/runtime, root/joint-tree, and model-validity failures still lead, but a large overlap, path-contact, exact-gap, mechanical-fit, or sampled-pose cluster should steer the next repair before incidental one-off physical details.

Relation-loop hints require evidence from distinct failed candidate revisions. A single candidate can report both overlap and gap/contact failures for the same part pair, but that is not an alternating-repair loop and should not trigger the "recent repairs alternated" hint.

Patch-application errors keep a `<repair_target_validation_context>` for the same previous candidate revision because the rejected patch was never validated. Patch application is all-or-nothing: no operation from a rejected patch is partially applied, so the next repair must resend any useful valid operations with the bad operation corrected. That target context must use the same failure ordering as normal validation feedback, so physical overlap/contact/sampled-pose defects still lead over mechanical relation-coverage evidence when both are present.

The agent loop keeps the visual-geometry and authored-check contract boundary strict during repair patches. Valid `expect_*` proof checks misplaced into a visual `geometry` path may be salvaged to `add /checks/-` so useful geometry edits in the same all-or-nothing patch can proceed. Presence checks (`part_exists` and `joint_exists`) are not salvaged from visual geometry because they are no-op repairs for physical contact, overlap, fit, support, clearance, or motion failures. A check-only patch is not a geometry repair and can otherwise create schema-valid but physically inert repair attempts that hide the original failure. Allowance descriptors (`allow_overlap` or `allow_isolated_part`) misplaced into visual geometry are still rerouted to `add /allowances/-` when their references are concrete, because allowances intentionally modify validation interpretation rather than asset shape. Salvage is skipped when the descriptor contains obvious placeholder references such as `x`, `y`, `a`, `b`, `__invalid__`, `part-a`, or `visual-b`; that stays a patch-application error with path/reference hints so impossible checks do not pollute candidate history.

Patch-application feedback places `<path_hints>` immediately after the patch error before the rejected patch summary and preserved validation context. This is deliberate: when a large repair patch writes a check, allowance, whole asset object, control, or pose descriptor into the wrong schema domain, the model should see the exact path rule before reading the long rejected patch dump. The preserved target validation context still follows so the next patch repairs the original physical/mechanical failures rather than sending a schema-only patch.

For repeated CAD-like mechanical relation-coverage failures, repair feedback can emit `<mechanical_contract_summary>`. This groups repeated coverage failures by contract code and affected part ids, such as all rods needing sampled-pose endpoint evidence or all pistons needing sampled-pose guide evidence. The individual validation signals remain authoritative, but the summary tells the model to repair repeated component classes as one mechanism contract instead of adding isolated filler checks.

## Runtime And Persistence Context

The LLM transcript is not persisted as a full conversation. Each create/edit run compiles a fresh prompt from current scene state, selected Create viewport asset when editing, optional image attachments, compact attempt context for the selected saved version, and saved user input for that version lineage.

IndexedDB stores asset records, ordered version records, validation attempts per version, optional per-version user input, and persisted agent progress events. Only validated assets are persisted as library versions. Invalid attempts are stored only as context under a saved valid version.

Persistence writes are scoped to the touched logical asset or deleted asset id. Normal saves do not clear and rewrite all stores, which keeps concurrent tabs from overwriting unrelated asset work.

Asset list ordering is by original creation time descending. Opening an asset defaults to its last selected version, falling back to the latest version. The scene store is runtime-only; persisted asset data and active viewport placement are separate.

## Headless Stress Harness

`test/headless/agentPipelineSmoke.test.ts` exercises the same embedded engine and agent loop without the GUI. It records candidate JSON, validation reports, request/response exchanges, progress timelines, probe reports, and GLB artifacts for inspection.

The harness wraps imported app provider clients for artifact capture, but it does not recreate provider switching or transport plumbing. `HEADLESS_AGENT_PROVIDER` selects the provider for a run and defaults to OpenAI. A headless-only OpenRouter adapter is available for provider-path comparison with `HEADLESS_AGENT_PROVIDER=openrouter`; it uses OpenRouter's Responses API endpoint with `openai/gpt-5.5`, keeps the app-facing provider list unchanged, and reads only `OPENROUTER_API_KEY`.

Headless-only conveniences stay in the test harness: Node file shims, local reference-image loading, artifact directory writing, per-attempt GLB materialization, repeated-failure diagnostic stop, and viewer URL generation. App source should change only for engine, validation, export, prompt, or provider behavior that matters to interactive runs too.

Current stress-run behavior:

- the default run budget is one hour
- ready candidates export static GLB artifacts
- assets with movable joints or material emission animation also export dynamic GLB artifacts
- every schema-parseable attempt exports inspection GLBs when possible
- every buildable attempt records a deterministic `probe.json`
- summaries include semantic failure clusters for loop analysis
- local reference images can be supplied through `HEADLESS_AGENT_IMAGE_PATH` or `HEADLESS_AGENT_IMAGE_PATHS`
- default artifacts live under `test/headless/artifacts/headless-agent/`
- summary JSON records exported GLB paths and viewer URLs
- OpenRouter client-only live smoke is opt-in with `HEADLESS_OPENROUTER_CLIENT_SMOKE=1 npm test -- test/headless/openRouterHeadlessClientLiveSmoke.test.ts`; the one-response full Manifest3D schema smoke is opt-in with `HEADLESS_OPENROUTER_MANIFEST_CLIENT_SMOKE=1 npm test -- test/headless/openRouterHeadlessClientLiveSmoke.test.ts`

## Progress Timeline

`validationTimeline.ts` supports projection from a single validation report and from candidate history. Candidate-attempt rows summarize revision, fingerprint, and repeated-failure streak before per-stage validation rows.

The app-facing progress timeline is built by interleaving agent loop events with candidate validation attempts. It is sectioned by attempt: `Initial attempt`, then `Repair N`. Completed `validating_candidate` events are normalized into candidate result rows. Failed attempts show concise validation summaries; successful attempts keep the full validation step trace. Routine provider details stay hidden, while failed agent events may show one concise detail line.

The timeline is a projection, not the validation model. UI code should derive it from candidate history, validation reports, and agent events rather than mutating timeline state directly.

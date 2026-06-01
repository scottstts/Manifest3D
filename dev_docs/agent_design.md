# Agent Design

This document describes the implemented Manifest3D agent pipeline: prompt compilation, provider boundaries, candidate freshness, repair feedback, persistence context, and headless stress runs.

## Prompt Sources

Prompt text lives under `src/engine/agent/prompts/` and is imported by `promptCompiler.ts` through Vite raw imports. Long prompt strings should stay out of `agentLoop.ts`, provider clients, UI code, and tests.

The prompt contract emphasizes:

- realistic geometry as the primary quality bar
- real-world scale and plausible materials
- softened manufactured forms through `roundedBox` and `capsule`
- explicit articulation for primary visible mechanisms and controls
- material `emission` and `emissionAnimation` for visible lights, LEDs, screens, and flashing or color-changing indicators
- deliberate material `side` selection, with `expect_material_side` checks for prompt-critical open or cutaway surfaces
- `controls` coverage for multi-joint mechanisms
- physically supported parts, with no unsupported visual islands
- scoped intentional overlap allowances paired with exact proof checks
- valid primitive parameters, including `roundedBox.radius <= min(size) / 2`
- stable semantic ids that avoid state words such as `open`, `closed`, or `extended`
- validation output treated as sensor data, not permission to simplify the requested object

Manifest3D agents return strict JSON assets for create/edit turns and JSON Patch repair envelopes for repair turns. They do not emit code.

## Prompt Compiler Contract

`compileManifestPrompt` returns separate `system` and `user` strings plus compact metadata. It composes the system identity, Contract V2 schema guidance, mode-specific create/edit/repair instructions, current scene summary, selected asset JSON for edit mode, compact candidate JSON for repair mode, image attachment metadata, prior validation feedback, and examples.

Create and edit mode expect a complete Manifest3D asset. Edit mode requires a selected asset and returns the full revised asset JSON. Repair mode includes the failed candidate and `<validation_signals>` feedback, but expects a JSON Patch envelope. The failed candidate remains complete and is minified in repair prompts to reduce context cost.

Image attachments flow through the same prompt compiler metadata and provider request path as ordinary app runs. The headless harness can load local reference image files for stress tests, but that filesystem convenience stays in `test/headless/agentPipelineSmoke.test.ts`.

## Provider Boundary

Provider-specific transport details belong inside provider clients. UI, scene, and persistence code talk through the agent loop and shared provider client interfaces.

OpenAI is the starting provider default. The last provider selected in the Providers panel is cached as the next default. API keys are never persisted outside local `.env` or the current browser session.

Localhost and loopback runs load provider keys only through the dev-server `.env` endpoint. The top-bar status dot is green when at least one local provider key is available. Non-localhost runs use in-memory per-provider keys from the Providers panel, and readiness reflects the currently selected provider.

OpenAI uses Responses API background mode in `openAiManifestClient.ts`: requests set `background: true` and `store: true`, then poll the response id until terminal status. This avoids one long idle HTTP response for high-reasoning strict-schema generations. The tradeoff is that background polling is not ZDR-compatible, so changing it requires a replacement long-running transport strategy.

Gemini repair mode uses a provider-only transport schema. The shared loop still receives canonical JSON Patch operations, but `geminiManifestClient.ts` asks Gemini for `op`, `path`, and JSON-stringified `valueJson`, then parses the values into canonical `{ value: unknown }` operations before returning. This keeps the central repair schema authoritative while avoiding Gemini structured-output schema complexity failures.

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

Repair turns return `{ "patch": [...] }`. The harness applies the patch to a cloned candidate, validates the fully patched asset against the Manifest3D schema, and only then accepts it as the next candidate. Patch application errors are fed into the next repair prompt without mutating the candidate.

Repair patches may address existing array entries by stable id through virtual JSON Pointer segments such as `/parts/byId/deck-truss/visuals/byId/deck-panel/transform/position`. The harness resolves those ids against the current candidate before applying ordinary JSON Patch semantics, which reduces stale array-index failures.

The repair response schema permits focused numeric vectors and point arrays. It avoids unconstrained empty array patch values because `[]` can satisfy many typed array branches while producing schema-invalid assets.

Repeated identical patch-application errors are tracked. The next repair prompt includes the streak, a compact rejected-operation summary, and targeted path hints for common mismatches such as writing `position`, `rotation`, or `scale` inside `joint.limits` instead of `joint.origin`.

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
6. export

Schema failures tell the model to fix JSON first. Structural failures emphasize stable ids, references, roots, and joint graph validity. Floating and overlap failures require either a physical fix or scoped allowances with exact proof. Missing exact geometry is treated as a stable-id contract failure.

Targeted repair rules cover recurring loops, including oversized `roundedBox.radius`, missing overlap proof checks, sampled-pose overlap repair, no-op controls, relation oscillation, and repeated rejected patch operations.

Repair feedback includes candidate revision and fingerprint so the model sees that validation evidence belongs to one exact candidate revision. It can also include `<failure_clusters>` and `<probe_report>` sections. Probe reports contain deterministic geometry measurements such as asset bounds, part bounds, joint-origin distances, connector endpoint measurements, closest visual pair, distance, penetration depth, and overlap volume. They are geometry sensor data, not rendered-image critique.

## Runtime And Persistence Context

The LLM transcript is not persisted as a full conversation. Each create/edit run compiles a fresh prompt from current scene state, selected Create viewport asset when editing, optional image attachments, compact attempt context for the selected saved version, and saved user input for that version lineage.

IndexedDB stores asset records, ordered version records, validation attempts per version, optional per-version user input, and persisted agent progress events. Only validated assets are persisted as library versions. Invalid attempts are stored only as context under a saved valid version.

Persistence writes are scoped to the touched logical asset or deleted asset id. Normal saves do not clear and rewrite all stores, which keeps concurrent tabs from overwriting unrelated asset work.

Asset list ordering is by original creation time descending. Opening an asset defaults to its last selected version, falling back to the latest version. The scene store is runtime-only; persisted asset data and active viewport placement are separate.

## Headless Stress Harness

`test/headless/agentPipelineSmoke.test.ts` exercises the same embedded engine and agent loop without the GUI. It records candidate JSON, validation reports, request/response exchanges, progress timelines, probe reports, and GLB artifacts for inspection.

The harness wraps imported app provider clients for artifact capture, but it does not recreate provider switching or transport plumbing. `HEADLESS_AGENT_PROVIDER` selects the provider for a run and defaults to OpenAI.

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

## Progress Timeline

`validationTimeline.ts` supports projection from a single validation report and from candidate history. Candidate-attempt rows summarize revision, fingerprint, and repeated-failure streak before per-stage validation rows.

The app-facing progress timeline is built by interleaving agent loop events with candidate validation attempts. It is sectioned by attempt: `Initial attempt`, then `Repair N`. Completed `validating_candidate` events are normalized into candidate result rows. Failed attempts show concise validation summaries; successful attempts keep the full validation step trace. Routine provider details stay hidden, while failed agent events may show one concise detail line.

The timeline is a projection, not the validation model. UI code should derive it from candidate history, validation reports, and agent events rather than mutating timeline state directly.

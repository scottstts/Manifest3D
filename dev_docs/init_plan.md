# Manifest3D Core Engine Build Plan

## Goal

Build `manifest3d` as a frontend-only React + Three.js WebGPU application where a user prompts for 3D assets, optionally attaches reference images, watches an agentic build loop progress in the right-side conversation panel, sees validated assets appear in the viewport, and exports selected assets as GLB.

The UI shell and WebGPU renderer are considered the stable foundation. The rest of the engine, schema, validation, prompt harness, agent loop, and export logic should be treated as provisional unless it aligns with the Articraft pipeline or with a deliberate browser-native adaptation of that pipeline.

Use `/Users/scott/Documents/Projects/Python/articraft` as a read-only reference for core engine ideas. Do not port Articraft's UI, CLI, storage system, Python execution model, URDF internals, batch infrastructure, FastAPI viewer, or dataset tooling. Do port the useful contract:

- A constrained authoring representation.
- Semantic parts, visuals, materials, joints, tests, and allowances.
- A compile/validate/probe feedback loop.
- Compiler-owned baseline QC.
- Authored prompt-specific exact checks.
- Structured repair feedback.
- A freshness rule: the agent cannot call the result successful unless the latest candidate passed validation.

## Project Scope

Project root:

```text
/Users/scott/Documents/Projects/Node/manifest3d
```

Reference project:

```text
/Users/scott/Documents/Projects/Python/articraft
```

Primary UI reference:

```text
refs/UI_ref.png
```

Planning and implementation notes:

```text
dev_docs/
```

## Testing Contract

Non-visual project logic must be implemented with corresponding unit tests in the same change. This applies especially to:

- Manifest3D schema parsing.
- Manifest3D validation and baseline QC.
- Geometry builders and geometry measurements.
- Exact prompt test runner.
- Allowance matching.
- Validation report and repair feedback construction.
- Candidate history and freshness state.
- Prompt compilation.
- Provider request construction.
- Agent-loop state transitions.
- Scene-store mutations.
- Selection state.
- GLB export filtering.

Every non-visual bug fix must include a regression test that fails before the fix and passes after it. Visual/UI work still needs manual browser verification when explicitly requested, but core engine correctness should be protected by automated tests from the start.

Run these after code changes unless the task is documentation-only:

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

## Product Assumptions

- The app remains frontend-only for the first implementation.
- WebGPU is required. Do not add WebGL fallback behavior.
- LLM calls happen from the browser for the prototype.
- LLM support includes OpenAI and Gemini.
- Local provider keys are supplied through project-root `.env` and fetched only from the localhost dev-server endpoint.
- API keys must not be exposed through Vite's public env prefix or persisted to browser storage.
- The Providers panel caches only the selected provider, never API keys.
- The model generates structured Manifest3D JSON, not arbitrary TypeScript, JavaScript, Python, shader code, or raw Three.js code.
- GLB export is generated client-side from the current Three.js scene.

## Current Baseline

Stable or mostly stable:

- Full-screen UI shell.
- Right-side chat/agent panel.
- WebGPU renderer.
- Three.js scene controller.
- Selection and camera behavior as already implemented.
- Existing visual styling direction.

Provisional and allowed to change substantially:

- Manifest schema.
- Validation types.
- Validation harness.
- Prompt test representation.
- Scene-store entry points.
- Agent modules.
- Example assets.
- Any logic that does not match this revised plan.

The existing validation implementation is useful as a first scaffold, but it should not constrain the final core design.

## Articraft Reference Map

Future agents should use these precise files instead of broadly searching Articraft.

### Compile And Baseline QC

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/agent/compiler.py
```

Important sections:

- `_compile_urdf_report_impl`, around lines 230-263: execute generated artifact, run authored tests, run compiler-owned baseline tests, merge reports, fail on blocking test failures.
- `_run_compiler_owned_baseline_tests`, around lines 1174-1206: baseline model validity, one root, mesh readiness, isolated parts, disconnected geometry islands, and current-pose overlaps.
- `_merge_test_reports`, around lines 1025-1120: authored and baseline reports are merged while preserving warnings and allowances.
- `_raise_for_failed_test_report`, around lines 1218-1232: blocking failures prevent successful compile.

Manifest3D adaptation:

- Replace Python execution with JSON parsing and Three.js build.
- Replace URDF export with GLB-export readiness checks.
- Keep the same conceptual order: candidate parse -> structural validity -> build -> baseline QC -> authored tests -> report -> commit only if valid.

### Signal Bundle And Report Shape

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/agent/models.py
```

Important section:

- `CompileSignal` and `CompileSignalBundle`, around lines 36-105.

Manifest3D adaptation:

- Use `ValidationSignal` and `ValidationSignalBundle`.
- Include severity, kind, code, summary, details, blocking, source, group, check name, and dedupe key.
- Timeline rows should be a UI projection of the signal bundle, not the source of truth.

### Repair Feedback Rendering

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/agent/feedback.py
```

Important sections:

- `build_compile_signal_bundle`, around lines 1100-1139: dedupe warnings, test warnings, allowance notes, failures, and runtime exceptions.
- `render_compile_signals`, around lines 1176-1248: render structured feedback block with summary, failures, warnings, notes, and response rules.
- `_response_rules_for_failures`, around lines 1251-1325: choose repair guidance based on primary failure kind.

Manifest3D adaptation:

- Render `<validation_signals>` instead of `<compile_signals>`.
- Preserve paths and ids from the JSON candidate.
- Prioritize schema/build/tree failures before local geometry tuning.
- Treat warnings as design evidence, not disposable logs.

### Freshness And Repeated Failure Tracking

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/agent/harness_compile.py
/Users/scott/Documents/Projects/Python/articraft/agent/harness.py
```

Important sections:

- `CompileFeedbackLoop`, around lines 40-89: edit revision, latest successful compile revision, cached success, compile attempts, repeated failure signature.
- `_render_compile_tool_output`, around lines 125-140: repeated failure and failure streak handling.
- `_handle_finish_attempt`, around lines 992-1019 in `harness.py`: success is allowed only when the latest code is fresh.

Manifest3D adaptation:

- Track candidate revisions or candidate fingerprints.
- Cache the latest successful validation report per active candidate.
- Do not allow the agent loop to report success after the candidate changes unless the newest candidate has passed validation.
- Keep repeated failure signatures for repair feedback and timeline display.

### Tool Contract For Explicit Validation

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/agent/tools/compile_model.py
```

Important section:

- Tool description around lines 41-50: baseline QC belongs to the harness; authored tests are for exact checks, targeted poses, and allowances.

Manifest3D adaptation:

- The browser agent may not expose a literal tool-call API at first, but the internal state machine should behave the same way.
- Baseline QC is always harness-owned.
- Generated tests are authored checks only.

### Authoring And Testing Semantics

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/sdk/_docs/common/80_testing.md
```

Important sections:

- Lines 9-11: `TestContext` records blocking failures, warnings, and allowances.
- Lines 38-60: `TestReport` fields.
- Lines 77-90: baseline QC versus prompt-specific exact assertions.
- Lines 92-106: high-signal testing habits.
- Lines 151-219: overlap and isolation allowances.

Manifest3D adaptation:

- Keep baseline QC separate from generated tests.
- Generated tests should prove prompt-critical exact relationships.
- Allowances require concrete reasons and should be scoped to exact part or visual pairs.

### Structural Validation

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/sdk/_core/v0/articulated_object.py
```

Important sections:

- `validate`, around lines 278-463: uniqueness, material refs, articulation refs, one parent articulation per child, joint limit semantics, mimic checks, geometry validation.
- `_validate_connectivity`, around lines 482-517: exactly one root and all parts reachable.

Manifest3D adaptation:

- Tighten part, visual, material, and joint identity rules.
- Joints are the assembly source of truth.
- Fixed joints connect rigidly mounted parts.
- Each non-root part should have exactly one parent joint.
- Parent/child cycles and unreachable parts are blocking failures.

### Baseline Geometry QC

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/sdk/_core/v0/_testing/model_checks.py
```

Important sections:

- `check_model_valid`, lines 37-47.
- `check_mesh_assets_ready`, lines 48-83.
- articulation-origin distance checks, lines 92-165.
- disconnected geometry island checks, lines 167-234.
- isolated/floating part checks, lines 236-338.
- current-pose overlap checks, lines 340-418.

Manifest3D adaptation:

- Start with deterministic Three.js bounds, projections, and contact graphs.
- Add mesh-level precision later if bounds-level checks produce too many false positives or false negatives.
- Current-pose overlap detection belongs in baseline validation, not in late polish.

### Exact Expectations

Reference:

```text
/Users/scott/Documents/Projects/Python/articraft/sdk/_core/v0/_testing/expectations.py
```

Important sections:

- `expect_contact`, around lines 105-143.
- `expect_gap`, around lines 145-238.
- `expect_overlap`, around lines 240-291.
- `expect_within`, around lines 293-360.

Manifest3D adaptation:

- Implement JSON equivalents of these checks.
- Tests should reference stable ids first, not display names.
- Visual ids used by tests become contracts.

## Core Design Decisions

These are the default decisions for the remaining implementation unless the user explicitly changes them.

### JSON Contract Instead Of Generated Code

Articraft generates Python, but Manifest3D should generate strict JSON. This avoids browser code execution risks and keeps the model inside a bounded authoring environment.

### Joints Are The Assembly Source Of Truth

Use joints, including `fixed` joints, as the authoritative assembly graph. Contract V2 removed part-level `parentId`; do not reintroduce a second hierarchy source unless there is a specific migration layer that derives it from joints.

Rules:

- Exactly one root part has no parent joint.
- Every other part has exactly one parent joint.
- A child part cannot have multiple parent joints.
- Joint parent and child cannot be the same part.
- Cycles are blocking failures.
- Unreachable parts are blocking failures.

### Stable IDs Are Contracts

Generated tests and allowances should reference ids, not names. Names remain human-readable labels.

Rules:

- Part ids are stable contracts.
- Visual ids are stable contracts.
- Joint ids are stable contracts.
- Material ids are stable contracts.
- If a test references a visual id, that visual cannot be renamed or deleted without updating the test in the same candidate.

### Coordinate Spaces

Define these coordinate spaces before implementing articulation preview or exact checks:

- Asset space: the root coordinate space for an asset.
- Part local space: each part owns a local frame.
- Visual local space: each visual transform is local to its owning part.
- Joint origin: expressed in the parent part's local space at rest.
- Child part frame: derived from the joint origin at rest.

The builder should construct the Three.js hierarchy from the joint graph, not from array order or from visual world transforms.

### Baseline QC And Authored Tests Are Separate

The harness owns baseline QC. The model-authored `tests` field should not duplicate baseline checks like one-root validation, missing materials, empty geometry, floating groups, or broad overlap scanning.

Generated tests should instead prove prompt-critical relationships:

- A lid contacts or nearly contacts a box rim.
- A handle is mounted on the correct side.
- A drawer sits within a cabinet opening.
- A wheel axle passes through wheel hubs.
- A telescoping member remains retained inside a sleeve.

### Allowances Are Explicit And Scoped

Intentional overlap or isolation must be declared with a reason. Broad allowances are discouraged.

Rules:

- Prefer exact visual-pair allowances over whole-part allowances.
- Every overlap allowance needs a concrete reason.
- Intentional overlap should usually be paired with exact tests proving the relationship.
- Allowances should produce notes or warnings in the validation report, not disappear silently.

### Browser Geometry QC Can Start Approximate

Articraft uses stronger geometry analysis than the browser prototype can reasonably start with. Manifest3D may begin with `Box3`, projection intervals, contact tolerances, and conservative graph checks. The plan must still treat overlap, floating parts, and disconnected islands as Phase 3 validation responsibilities.

If approximate checks prove insufficient, add a mesh-level geometry helper or BVH dependency later.

## Revised Source Structure

Keep UI and renderer modules as already implemented. The remaining core should move toward this structure:

```text
src/
  engine/
    config/
      modelConfig.ts
    schema/
      manifestTypes.ts
      manifestSchema.ts
      manifestContract.ts
      validationTypes.ts
    geometry/
      primitiveBuilders.ts
      proceduralBuilders.ts
      assetBuilder.ts
      bounds.ts
      measurements.ts
      contactGraph.ts
      overlapChecks.ts
    validation/
      validateManifest.ts
      validateSchema.ts
      validateStructure.ts
      validateJoints.ts
      validateGeometryDescriptors.ts
      runBaselineQc.ts
      runPromptChecks.ts
      runAllowances.ts
      reportBuilder.ts
    agent/
      agentLoop.ts
      candidateHistory.ts
      providerClient.ts
      openAiManifestClient.ts
      promptCompiler.ts
      repairFeedback.ts
      examples.ts
      validationTimeline.ts
      prompts/
        system.md
        createAsset.md
        editAsset.md
        repairAsset.md
        schema.md
        examples.md
    scene/
      sceneStore.ts
      selectionStore.ts
      exportGlb.ts
```

Engine modules should be plain TypeScript where possible. React should orchestrate UI state but should not own validation, prompt compilation, candidate history, or provider request construction.

## Manifest3D Contract V2

Contract V2 is implemented as the current schema baseline. Future schema changes should preserve the same core decisions unless explicitly redesigned: stable ids, joint-driven hierarchy, authored `checks`, and scoped `allowances`.

Target shape:

```ts
type ManifestAsset = {
  schemaVersion: 2
  id: string
  name: string
  prompt: string
  units: "meters"
  parts: ManifestPart[]
  joints: ManifestJoint[]
  controls: ManifestJointControl[]
  materials: ManifestMaterial[]
  checks: ManifestCheck[]
  allowances: ManifestAllowance[]
  metadata: ManifestAssetMetadata
}
```

Part:

```ts
type ManifestPart = {
  id: string
  name: string
  role?: ManifestPartRole
  description?: string
  visuals: ManifestVisual[]
}
```

Visual:

```ts
type ManifestVisual = {
  id: string
  name?: string
  geometry: ManifestGeometry
  transform: ManifestTransform
  materialId: string
}
```

Joint:

```ts
type ManifestJoint = {
  id: string
  name: string
  type: "fixed" | "revolute" | "prismatic" | "continuous"
  parentPartId: string
  childPartId: string
  origin: ManifestTransform
  axis?: ManifestVector3
  limits?: ManifestJointLimits
}
```

Joint limit rules:

- `fixed`: no limits and no required axis.
- `revolute`: nonzero axis and required `lower`/`upper`.
- `prismatic`: nonzero axis and required `lower`/`upper`.
- `continuous`: nonzero axis and no `lower`/`upper`. If effort/velocity are represented, they must be positive.

This mirrors the strict Articraft semantics in `articulated_object.py`.

Check examples:

```ts
type ManifestCheck =
  | { type: "part_exists"; partId: string }
  | { type: "joint_exists"; jointId: string; jointType?: ManifestJointType }
  | { type: "expect_contact"; partAId: string; partBId: string; visualAId?: string; visualBId?: string; contactTolerance?: number }
  | { type: "expect_gap"; positivePartId: string; negativePartId: string; axis: "x" | "y" | "z"; minGap?: number; maxGap?: number; maxPenetration?: number; positiveVisualId?: string; negativeVisualId?: string }
  | { type: "expect_overlap"; partAId: string; partBId: string; axes: "x" | "y" | "z" | "xy" | "xz" | "yz" | "xyz"; minOverlap?: number; visualAId?: string; visualBId?: string }
  | { type: "expect_within"; innerPartId: string; outerPartId: string; axes: "x" | "y" | "z" | "xy" | "xz" | "yz" | "xyz"; margin?: number; innerVisualId?: string; outerVisualId?: string }
```

Allowance examples:

```ts
type ManifestAllowance =
  | { type: "allow_overlap"; partAId: string; partBId: string; visualAId?: string; visualBId?: string; reason: string }
  | { type: "allow_isolated_part"; partId: string; reason: string }
```

Keep current simpler tests only if they remain useful as smoke checks. They are not sufficient as the core authored-test model.

## Geometry Builder Requirements

The builder converts Manifest3D JSON into a Three.js `Group`.

Responsibilities:

- Build material map.
- Build visual meshes from geometry descriptors.
- Apply visual transforms in part-local space.
- Build part groups.
- Build the asset hierarchy from the joint graph.
- Apply fixed/revolute/prismatic/continuous rest transforms.
- Attach `userData` for asset, part, visual, and joint refs.
- Compute asset, part, and visual bounds.
- Preserve enough metadata for selection, exact tests, and export filtering.

Supported geometry types:

- `box`
- `roundedBox`
- `cylinder`
- `capsule`
- `sphere`
- `cone`
- `torus`
- `lathe`
- `extrude`
- `tube`

Use clean primitive composition first. Do not add arbitrary mesh-code generation. `roundedBox` and `capsule` are now part of Contract V2 because live pipeline runs showed they materially improve manufactured-object quality without introducing arbitrary mesh code. Add CSG or hollow-specific primitives only when repeated prompt failures show that additive primitives and existing path/lathe/extrude/tube composition are inadequate.

## Validation Harness

The validation harness is the browser-native equivalent of Articraft's compile/QC loop.

Pipeline:

```text
unknown candidate
-> schema parse
-> structural validation
-> geometry descriptor validation
-> build isolated Three.js candidate
-> baseline QC
-> authored prompt checks
-> export readiness smoke check
-> validation signal bundle
-> commit only if no blocking failures
```

Blocking schema or structural errors should skip later stages that cannot run safely. Warnings should not block commit, but they should remain visible in the report and repair feedback.

### Validation Report Types

Implement a report core similar to Articraft's signal bundle:

```ts
type ValidationSignal = {
  severity: "failure" | "warning" | "note"
  kind: string
  code: string
  summary: string
  details?: string
  blocking: boolean
  source: "schema" | "validator" | "baseline_qc" | "checks" | "harness" | "export"
  group: "build" | "qc" | "design" | "hygiene"
  checkName?: string
  path?: string
  refs?: Record<string, string>
  dedupeKey?: string
}

type ValidationSignalBundle = {
  status: "success" | "failure"
  summary: string
  signals: ValidationSignal[]
}
```

The UI timeline should derive compact rows from `ValidationSignalBundle`.

### Structural Validation

Blocking checks:

- Asset has at least one part.
- Part ids are unique.
- Visual ids are unique at least within an asset.
- Material ids are unique.
- Joint ids are unique.
- Every visual references an existing material.
- Every joint references existing parent and child parts.
- A joint cannot connect a part to itself.
- Exactly one root part exists.
- Every non-root part has exactly one parent joint.
- No cycles.
- Every part is reachable from the root.
- Joint limits match joint type.
- Scalar joints have a nonzero finite axis.
- Geometry descriptors have finite positive dimensions where required.
- Transforms are finite.

### Baseline QC

Harness-owned baseline QC should include:

- Built asset has at least one mesh.
- Built asset has finite, non-empty bounds.
- Each part has renderable geometry unless explicitly allowed by a future nonvisual-role rule.
- Asset dimensions are plausible in meters.
- Part dimensions are not near-zero unless intentionally thin but still positive.
- Export traversal can find serializable mesh geometry.
- Part graph is physically supported, not merely semantically connected.
- Disconnected geometry islands inside a single part produce at least warnings.
- Current-pose part overlaps are blocking unless covered by explicit scoped allowances.
- Joint origins that are far from both parent and child geometry produce warnings or failures, depending on tolerance.

Initial implementation may use approximate bounds and projection checks. The harness should be written so mesh-level checks can replace approximate checks without changing report shape.

### Authored Prompt Checks

Prompt checks run after baseline QC has built a usable candidate.

Implement these first:

- `expect_contact`
- `expect_gap`
- `expect_overlap`
- `expect_within`
- `part_exists`
- `joint_exists`

Behavior:

- Check refs must resolve by id.
- Missing referenced parts or visuals are failures.
- Details should include measured gap, overlap, contact distance, axes, tolerances, and involved refs.
- Exact visual refs are contracts.
- Tests should be deterministic.

### Allowance Handling

Allowances are authored declarations consumed by baseline QC.

Rules:

- `allow_overlap` can suppress a baseline overlap failure only when the reported pair matches the allowance scope.
- Visual-scoped allowances are preferred.
- Part-wide allowances are allowed only with a concrete reason and should emit a warning or note.
- `allow_isolated_part` can suppress floating-part failures only for exact listed part ids.
- Allowance notes should be included in validation output.

## Repair Feedback Compiler

Create `src/engine/agent/repairFeedback.ts`.

It should take a `ValidationSignalBundle` and render a concise model-facing block:

```text
<validation_signals>
<summary>
...
</summary>

<failures>
...
</failures>

<warnings>
...
</warnings>

<notes>
...
</notes>

<response_rules>
...
</response_rules>
</validation_signals>
```

Repair rules should be deterministic and based on primary failure kind:

- Schema parse failures: fix JSON shape first.
- Structural failures: fix ids, refs, roots, cycles, and joint tree before geometry.
- Build failures: fix geometry descriptors or transform data before tests.
- Floating parts: add or correct physical support path, or add scoped allowance only if intentional.
- Overlaps: decide intentional versus unintended; fix geometry or add scoped allowance with exact proof checks.
- Missing exact geometry: restore referenced visual id or update the dependent check.
- Exact contact/gap failures: adjust placement or check refs; do not blindly relax tolerances.

This should follow the pattern in `agent/feedback.py`.

## Candidate History And Freshness

Create `src/engine/agent/candidateHistory.ts`.

Responsibilities:

- Track active run id.
- Track candidate revision or fingerprint.
- Store validation reports for every candidate attempt, including failed attempts.
- Store latest successful validation report.
- Detect repeated failure signatures.
- Expose whether the latest candidate is fresh and valid.

Agent success rule:

```text
The agent can report ready only if the latest candidate fingerprint matches the latest successful validation report.
```

Invalid candidates must not be committed to the scene, but their reports must remain visible to the agent loop and timeline.

## Prompt Compiler

Create prompt files under:

```text
src/engine/agent/prompts/
```

Required files:

- `system.md`: core identity, quality bar, JSON-only rule, Manifest3D contract.
- `schema.md`: compact schema summary.
- `createAsset.md`: create-mode task.
- `editAsset.md`: selected-asset edit task.
- `repairAsset.md`: repair instructions.
- `examples.md`: compact high-quality examples.

The prompt compiler should compose:

- System prompt.
- Manifest3D Contract V2 summary.
- Current scene summary.
- Selected asset JSON for edits.
- User prompt.
- Image attachment metadata.
- Validation feedback from prior attempt.
- Examples.

Do not put long prompt strings inside `agentLoop.ts` or provider clients.

The prompt should teach the model:

- Return strict JSON only.
- Use meters.
- Use stable ids.
- Prefer multiple simple named parts over one anonymous mesh.
- Use fixed joints for rigidly mounted child parts.
- Use movable joints for visible mechanisms.
- Keep parts physically supported.
- Avoid unintentional overlaps.
- Use allowances only when intentional and scoped.
- Include exact checks for prompt-critical claims.
- Preserve referenced ids during repair unless intentionally updating checks too.

## Provider Clients

Create a narrow client abstraction:

```ts
type ManifestProviderClient = {
  generateAsset(request: AgentRequest): Promise<AgentResponse>
}
```

Current implementation:

- OpenAI and Gemini are supported behind the same agent-loop interface.
- OpenAI remains the starting default; the last user-selected provider is cached as the next default.
- Browser `fetch` for prototype unless explicitly changed later.
- Localhost reads provider API keys only from the dev-server `.env` endpoint; deployed origins use per-provider in-memory keys from the Providers panel.
- Read model settings only from `src/engine/config/modelConfig.ts`.
- `modelConfig.ts` must not hardcode a provider field.
- Do not log or display the API key.
- If no key exists, return a controlled unavailable state and keep the app usable.
- Use structured output requiring strict Manifest3D JSON.
- Include user text, scene summary, selected asset for edits, schema summary, examples, images, and validation feedback.
- Use `AbortController` once cancellation exists.

Before changing provider request code, verify the current official provider docs and keep all API-specific translation inside provider clients.

Current OpenAI config:

```ts
export const modelConfig = {
  model: "gpt-5.5",
  reasoningEffort: "high",
  temperature: 1.0,
  maxOutputTokens: 64_000,
  agentRunTimeoutMs: 3_600_000,
} as const
```

Current Gemini config:

```ts
export const geminiModelConfig = {
  model: "gemini-flash-latest",
  thinkingLevel: "high",
  temperature: 1.0,
  maxOutputTokens: 64_000,
  agentRunTimeoutMs: 3_600_000,
} as const
```

## Agent Loop

Create `src/engine/agent/agentLoop.ts` as a state machine.

States:

```text
idle
-> compiling_prompt
-> requesting_model
-> parsing_candidate
-> validating_candidate
-> repairing
-> committing
-> ready | failed | cancelled
```

Loop:

1. Compile prompt.
2. Send request to OpenAI client.
3. Parse strict JSON.
4. Validate candidate through the harness.
5. Store validation report in candidate history.
6. If valid and fresh, commit to scene store.
7. If invalid, render repair feedback and ask the model to revise.
8. Stop after turn cap or cancellation.

Initial repair turn cap:

```text
10
```

The agent loop must not hardcode model settings. It must not apply malformed or invalid candidates to the main scene.

## Scene Commit Gate

Scene commit should happen through a single validation-aware entry point.

Rules:

- Only validated candidates can be committed.
- The committed asset must match the successful validation fingerprint.
- Invalid candidates remain in candidate history only.
- Edit mode replaces the selected asset only after validation passes.
- Create mode adds a new asset only after validation passes.

## GLB Export

GLB export is implemented after validation and agent loop foundations.

Requirements:

- Export selected asset only.
- Clone the asset group.
- Strip grid, axes, selection outlines, helper objects, UI-only metadata, and any non-exportable diagnostic objects.
- Use `GLTFExporter` in binary mode.
- Name output from asset name.
- Surface export failures in the agent/status panel.

Validation includes export-readiness smoke checks. User-facing export is implemented for Create assets, and the headless stress harness now exports ready candidates as GLB artifacts for visual inspection.

## Revised Implementation Phases

### Phase 1: UI Shell And WebGPU Renderer

Status:

- Mostly complete.
- Treat existing UI and renderer as the stable visual foundation.

Do not redo this phase unless explicitly requested.

### Phase 2: Renderer Integration Foundation

Status:

- Mostly complete.
- Selection, camera recentering, WebGPU scene setup, and viewport chrome are the practical base.
- The renderer-adjacent Contract V2 update is implemented: `assetBuilder` now assembles parts through the joint graph instead of part-level `parentId`.

Future renderer work should build on this joint-driven hierarchy rather than restoring the legacy `parentId` path.

### Phase 3: Manifest3D Contract V2 And Articraft-Aligned Validation

Status:

- Implemented for the local browser harness.
- Later phases added repair feedback rendering, candidate history/freshness, prompt compilation, the real OpenAI loop, controls, dynamic export, and additional geometry fidelity improvements.

Tasks:

- Redesign Manifest3D schema around stable ids, joint-driven hierarchy, checks, and allowances.
- Migrate or replace current validation types with `ValidationSignalBundle`.
- Implement structural validation.
- Implement geometry descriptor validation.
- Implement isolated candidate build from the joint graph.
- Implement baseline QC: bounds, mesh readiness, export traversal, floating support graph, disconnected geometry island warnings, overlap checks, and joint-origin sanity.
- Keep the targeted hollow `torus`/`tube` segment overlap proxy so grilles and ring guards are not treated as filled disks.
- Implement allowance handling.
- Implement exact prompt checks.
- Add deterministic fixtures for valid, invalid, overlap, allowance, floating, disconnected-island, and exact-check cases.

Acceptance:

- Invalid schema candidates produce path-specific blocking signals.
- Invalid joint tree candidates fail before geometry tuning.
- Valid candidates build into a Three.js group.
- Floating unsupported part groups fail unless explicitly allowed.
- Current-pose overlaps fail unless explicitly allowed.
- Exact contact/gap/overlap/within checks pass and fail deterministically.
- Validation timeline can display real reports and failed candidate attempts.
- Unit tests cover baseline QC, exact checks, allowances, and report projection.

### Phase 4: Repair Feedback, Prompt Compiler, And Candidate Freshness

Tasks:

- Add `repairFeedback.ts`.
- Add prompt files and `promptCompiler.ts`.
- Add candidate history and freshness tracking.
- Add repeated failure signature detection.
- Add validation timeline projection from history.

Acceptance:

- Repair feedback renders `<validation_signals>` blocks with failures, warnings, notes, and response rules.
- Repeated failure attempts are detected and surfaced.
- Agent cannot report ready unless the latest candidate has a fresh successful validation report.
- Prompt compiler imports prompt files instead of embedding long prompt strings inline.
- Unit tests cover repair feedback priority, freshness, repeated signatures, and prompt composition.

### Phase 5: Agent Loop With Real Providers

Tasks:

- Add `modelConfig.ts`.
- Add provider clients.
- Verify current official provider request and structured-output shape before implementation.
- Add real create mode.
- Add real edit mode.
- Add repair loop.
- Add missing-key unavailable state.
- Add image attachment payload support.

Acceptance:

- With a supported local `.env` provider key or in-memory deployed-origin key, user can prompt asset creation.
- With no key, app reports generation unavailable without breaking the existing scene.
- Provider request parameters come from `modelConfig`.
- Model output is parsed, validated, and committed only if valid.
- Invalid output triggers repair loop within the turn cap.
- Failed candidates and repair reports remain visible in history/timeline.
- Image attachments are included in requests.
- Unit tests cover request construction, missing key, response parsing, state transitions, and repair loop behavior without network calls.

### Phase 6: GLB Export

Tasks:

- Add `exportGlb.ts`.
- Add selected asset export toolbar behavior if not already final.
- Strip helpers and metadata.
- Verify exported binary can be opened or re-imported locally.

Acceptance:

- Selected asset downloads as `.glb`.
- Movable assets can export static and dynamic GLB variants.
- Export excludes grid, axes, selection outlines, helper objects, and UI-only metadata.
- Exported GLB contains expected geometry and materials.
- Unit tests cover export filtering logic where possible.

### Phase 7: Articulation Preview And Geometry Fidelity

Tasks:

- Add joint preview controls, including manifest-declared grouped controls and per-joint fallback controls.
- Animate or scrub revolute/prismatic/continuous controls.
- Add sampled-pose validation for prompt-critical mechanisms.
- Improve overlap/contact checks from bounds-level to targeted hollow-shape proxies or mesh-level checks if needed.
- Add additional procedural geometry only where validation or prompt quality demands it.

Acceptance:

- Generated joints and grouped controls can be inspected.
- Multi-joint movable assets declare controls that cover their movable joints.
- Pose-specific exact checks can run deterministically.
- The validation report can distinguish rest-pose and sampled-pose findings.

### Phase 8: Reliability And Persistence

Tasks:

- Add local scene persistence.
- Add cancellation.
- Add stronger mobile panel behavior.
- Add better generated examples.
- Add optional local debug view for validation reports.

Acceptance:

- User can create, edit, inspect, select, validate, and export assets in one session.
- Agent failures are explainable.
- The app feels like a coherent creation tool, not a demo.

## Required Unit Test Matrix

Schema and structure:

- Valid Contract V2 asset parses.
- Malformed geometry rejects with path.
- Duplicate ids reject.
- Missing material rejects.
- Missing joint parent or child rejects.
- Multi-root rejects.
- No-root cycle rejects.
- Child with multiple parent joints rejects.
- Revolute without limits rejects.
- Prismatic without limits rejects.
- Continuous with lower/upper limits rejects.

Geometry and baseline QC:

- Empty asset bounds fail.
- Tiny asset fails.
- Huge asset warns or fails according to configured threshold.
- Part with no renderable geometry fails.
- Export traversal with no meshes fails.
- Floating part group fails.
- Allowed isolated part passes with note or warning.
- Disconnected visual islands inside a part warn or fail according to policy.
- Overlap fails.
- Scoped overlap allowance suppresses only matching overlap.
- Broad overlap allowance emits note or warning.
- Joint origin far from geometry warns or fails according to tolerance.

Prompt checks:

- `expect_contact` pass and fail.
- `expect_gap` pass and fail.
- `expect_overlap` pass and fail.
- `expect_within` pass and fail.
- Missing referenced visual fails.
- Renamed visual referenced by a check fails.

Repair and agent:

- Report bundle dedupes repeated signals.
- Repair feedback prioritizes schema before geometry.
- Repair feedback prioritizes tree failures before overlap.
- Repeated failure signature increments streak.
- Fresh successful validation allows commit.
- Candidate mutation after validation clears freshness.
- Agent repair loop retries invalid candidate.
- Agent stops at turn cap.
- Missing provider key returns controlled unavailable state.

Export:

- Export strips helper objects.
- Export selects only requested asset.
- Export naming is stable.

## Main Risks

- Frontend-only provider calls expose user-provided in-memory keys to the browser runtime. Local `.env` keys must only be served by the localhost dev-server endpoint and must not enter the built bundle.
- Direct browser calls to providers may hit CORS or API-shape constraints. Verify early with the smallest real request.
- Browser geometry QC may start approximate and require mesh-level precision later.
- Additive primitive modeling makes hollow objects, cavities, sleeves, sockets, and cutouts hard. Prefer composed wall geometry first; add CSG only when necessary.
- If the hierarchy model becomes ambiguous again, articulation preview and exact tests will become unreliable. Preserve Contract V2's joint-driven hierarchy through the real agent loop.
- If validation history is deferred, invalid repair attempts will disappear because invalid candidates are intentionally not committed.

## Definition Of Done For First Useful Prototype

The first useful prototype is complete when:

- The app opens to the Manifest3D creation workspace.
- WebGPU viewport renders validated Manifest3D assets.
- User can prompt through the right panel using OpenAI or Gemini with local `.env` or in-memory provider keys.
- The agent loop validates every candidate before commit.
- Failed candidates produce structured repair feedback and remain visible in history.
- Valid assets appear in the viewport.
- User can select an asset and orbit around its center.
- Selected asset can be exported as GLB.
- Unit tests, typecheck, lint, and build pass.

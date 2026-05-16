# Manifest3D Initial Build Plan

## Goal

Build `manifest3d` as a frontend-only React + Three.js WebGPU application where a user prompts for 3D assets, optionally attaches reference images, watches the agentic build loop progress in a right-side conversation panel, sees assets appear and update directly in the viewport, and exports selected assets as GLB.

Use `/Users/scott/Documents/Projects/Python/articraft` as a read-only reference for the engine pattern. Do not port its UI, CLI, storage system, Python runtime, or FastAPI viewer. Port the useful core idea: a constrained asset authoring contract, domain-specific primitives, compile/validate/probe feedback, and an iterative agent loop that cannot call a run successful until the asset is structurally valid and renderable.

## Project

`/Users/scott/Documents/Projects/Node/manifest3d` is a Vite React TypeScript app, this is the project that you will build

- `refs/UI_ref.png` is the primary visual reference for the intended app direction.
- `dev_docs/` exists and should hold implementation planning docs.

## Testing Contract

Non-visual project logic must be implemented with corresponding unit tests in the same change. This especially applies to the agent harness, OpenAI request construction, prompt compilation, Manifest3D schema parsing, asset validation, geometry builders, scene-store mutations, selection state, and GLB export filtering.

Every bug fix in non-visual logic must include a regression test that fails before the fix and passes after it. Do not defer these tests to a later cleanup phase. Visual/UI work still needs manual browser verification and screenshots where useful, but core engine correctness should be protected by automated tests from the start.

## Product Assumptions

This plan assumes:

- The app remains frontend-only for the first implementation.
- WebGPU is required. Do not add WebGL fallback behavior. If `navigator.gpu` is unavailable, show a clear unsupported-browser state.
- LLM calls must happen from the browser.
- Initial LLM support is OpenAI only.
- The OpenAI key is supplied through a project-root `.env` file for now. In Vite, use `VITE_OPENAI_API_KEY=...` so the frontend can read it through `import.meta.env.VITE_OPENAI_API_KEY`.
- Because a Vite-exposed `.env` value is bundled into client-side code, this is local/private prototype behavior only. Do not treat it as production-safe.
- Do not build a provider settings UI or local-storage API-key flow in the first implementation unless explicitly requested later.
- The initial engine should generate structured Manifest3D scene JSON, not arbitrary TypeScript or raw shader code. This is the closest frontend-native equivalent of Articraft's generated `model.py` contract.
- GLB export is generated client-side from the current Three.js scene.

## Reference Concepts From Articraft

Port these ideas conceptually:

- Fixed artifact contract: Articraft requires generated `model.py` to define `build_object_model()`, `run_tests()`, and `object_model`.
- Semantic asset SDK: Articraft represents objects as parts, visuals, materials, articulations, and tests instead of anonymous meshes.
- Compile loop: generated code is executed and validated before it is accepted.
- Baseline QC: the harness checks roots, missing geometry, floating parts, disconnected geometry, overlaps, and exportability.
- Prompt-specific checks: the model is asked to encode claims about the object and verify them.
- Structured feedback: validation failures are returned to the agent as repair instructions.
- Curated examples/docs: the model operates inside a bounded authoring environment rather than the whole app.

Do not port:

- Python execution.
- URDF as the internal authoring format.
- FastAPI materialization.
- Dataset storage and batch infrastructure.
- Viewer search, ratings, or record management.

## Engine Strategy

The core browser-native engine should be built around a Manifest3D document schema:

```ts
type ManifestScene = {
  schemaVersion: 1
  units: "meters"
  assets: ManifestAsset[]
}

type ManifestAsset = {
  id: string
  name: string
  prompt: string
  parts: ManifestPart[]
  joints: ManifestJoint[]
  materials: ManifestMaterial[]
  tests: ManifestTest[]
  metadata: {
    createdAt: string
    updatedAt: string
    sourceImageIds: string[]
    generationStatus: "draft" | "validating" | "ready" | "failed"
  }
}
```

The agent should generate or revise this JSON document. The renderer should convert the JSON into Three.js objects. Validation should run against the JSON and built Three.js geometry. Export should serialize the selected asset group to GLB.

This avoids letting the model emit arbitrary app code and gives Codex a clean TypeScript surface to build and test.

## Proposed Source Structure

Create this structure during implementation:

```text
src/
  app/
    App.tsx
    AppShell.tsx
    appState.ts
  engine/
    config/
      modelConfig.ts
    schema/
      manifestTypes.ts
      manifestSchema.ts
      validationTypes.ts
    geometry/
      primitiveBuilders.ts
      proceduralBuilders.ts
      assetBuilder.ts
      bounds.ts
    validation/
      validateManifest.ts
      validateConnectivity.ts
      validateJoints.ts
      validateGeometry.ts
      promptChecks.ts
    agent/
      agentLoop.ts
      providerClient.ts
      promptCompiler.ts
      toolProtocol.ts
      repairFeedback.ts
      examples.ts
      prompts/
        system.md
        createAsset.md
        editAsset.md
        repairAsset.md
        visibilitySteps.md
    scene/
      sceneStore.ts
      selectionStore.ts
      exportGlb.ts
  renderer/
    WebGPUCanvas.tsx
    createRenderer.ts
    sceneController.ts
    controls.ts
    lighting.ts
    picking.ts
    axesGizmo.ts
    materials.ts
  ui/
    ChatPanel.tsx
    AgentTimeline.tsx
    PromptComposer.tsx
    ViewportToolbar.tsx
    UnsupportedWebGPU.tsx
    FrameChrome.tsx
  styles/
    app.css
  assets/
    ...
```

Keep the engine modules independent from React where possible. React should orchestrate UI state; engine modules should be plain TypeScript. Keep model/provider settings in `engine/config/modelConfig.ts`, and keep reusable prompt text in separate files under `engine/agent/prompts/`. The agent loop should import config and prompt files rather than embedding model settings or long prompt strings inline.

## Dependency Plan

Add runtime dependencies:

- `three` for WebGPU renderer, scene graph, controls, and GLB export.
- `lucide-react` for small UI icons.
- `zod` for Manifest3D schema validation.

Add development/test dependencies:

- `vitest` for unit tests covering non-visual engine logic.
- `jsdom` only if DOM-specific tests are needed; prefer plain TypeScript tests for engine modules.

Likely import pattern for WebGPU:

```ts
import * as THREE from "three/webgpu"
```

Use Three.js examples only where they work with the WebGPU package entry point. Verify GLTF/GLB exporter compatibility during implementation.

Do not add large UI frameworks initially. The target visual design is custom and constrained.

## Model Configuration

Put model/provider settings in one dedicated file:

```text
src/engine/config/modelConfig.ts
```

Initial config:

```ts
export const modelConfig = {
  provider: "openai",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  temperature: 1.0,
  maxOutputTokens: 64_000,
} as const
```

Implementation requirements:

- The OpenAI client must read all model settings from `modelConfig`.
- The agent loop must not hardcode model name, reasoning effort, temperature, or output-token limit.
- If OpenAI API parameter names differ from the config field names, translate them only inside the OpenAI client.
- Future provider changes should happen by changing `modelConfig` and adding a matching client, not by rewriting the agent loop.
- Keep API key loading separate from `modelConfig`; read `VITE_OPENAI_API_KEY` from `import.meta.env`.

## Visual Direction

Visual thesis: a soft sci-fi creation bay with a large calm WebGPU viewport, frosted lavender-white chrome, sparse controls, and a right-side agent console.

Key layout:

- Full-viewport app.
- Large 3D workspace as the primary surface.
- Top center Manifest3D title integrated into frame chrome.
- Right panel for chat plus agent visibility.
- Viewport toolbar appears contextually, especially when an asset is selected.
- Use the reference image as guidance for proportions, not as a literal background.

Important UI rules:

- The first screen is the usable app, not a landing page.
- Avoid generic dashboard card grids.
- Do not put cards inside cards.
- Keep the viewport dominant.
- Use subtle border layers, translucent panels, and precise spacing rather than heavy gradients.
- On smaller screens, collapse the right panel into a drawer or bottom sheet; do not make the viewport unusable.

## WebGPU Renderer Plan

Build a dedicated `WebGPUCanvas` component that owns renderer lifecycle.

Renderer requirements:

- Use `THREE.WebGPURenderer`.
- Await `renderer.init()` before first render.
- Fail gracefully if WebGPU is unavailable.
- Use resize observer for canvas sizing.
- Use a single scene, perspective camera, lighting rig, grid/floor, and optional axes gizmo.
- Keep renderer, scene, camera, controls, raycaster, and asset root in a controller object outside React render cycles.

Interaction requirements:

- Single click selects an asset.
- Selection recenters orbit target to the selected asset bounding-box center.
- Drag orbits.
- Shift + drag pans.
- Scroll up zooms in; scroll down zooms out.
- Selection state drives a top-right viewport toolbar with `Export GLB`.

Implementation notes:

- Use raycasting against selectable asset groups.
- Store `assetId` and `partId` in `object.userData`.
- After selecting, compute `Box3` over the asset group and animate camera target toward center.
- Use OrbitControls as the base control system, configured so normal drag rotates and shift drag pans.
- If OrbitControls does not meet the exact input behavior cleanly with WebGPU imports, implement a small custom control layer after the first renderer milestone.

## Manifest3D Schema

Start with a deliberately limited schema that can still create useful assets:

- primitives: box, cylinder, sphere, cone, capsule-like rounded cylinder, torus if practical
- procedural meshes: extruded polygon, lathe profile, simple tube/path sweep
- transforms: position, rotation Euler, scale
- materials: color, metalness, roughness, opacity
- hierarchy: asset -> parts -> visuals
- joints: fixed, revolute, prismatic, continuous
- limits: lower/upper where applicable
- annotations: semantic names and description

Example part shape:

```ts
type ManifestPart = {
  id: string
  name: string
  parentId: string | null
  visuals: ManifestVisual[]
  role?: "base" | "housing" | "handle" | "wheel" | "hinge" | "control" | "decor"
}
```

Example visual shape:

```ts
type ManifestVisual = {
  id: string
  geometry: ManifestGeometry
  transform: ManifestTransform
  materialId: string
}
```

Use Zod schemas to parse and reject malformed agent output before rendering.

## Geometry Builder

Build `assetBuilder.ts` to convert `ManifestAsset` into a Three.js `Group`.

Responsibilities:

- Create part groups.
- Create visual meshes from geometry descriptors.
- Apply local transforms.
- Apply material definitions.
- Attach selection metadata in `userData`.
- Compute and cache bounding boxes.
- Build joint pivot groups so articulations can be previewed later.

Initial geometry builders:

- `box`
- `cylinder`
- `sphere`
- `cone`
- `torus`
- `lathe`
- `extrude`
- `tube`

For "good enough" first build, prefer clean primitive composition over complex mesh generation. The harness quality comes from iteration and validation, not from supporting every shape up front.

## Validation Engine

Create a TypeScript validation pipeline analogous to Articraft's compile/QC loop:

```text
parse JSON
-> schema validation
-> semantic validation
-> build Three.js scene graph
-> geometry validation
-> export smoke check
-> return structured feedback
```

Baseline validation should include:

- asset has at least one part
- part IDs and material IDs are unique
- every visual references a valid material
- geometry parameters are finite and positive
- transforms are finite
- exactly one root part per asset
- every non-root part has a valid parent or joint connection
- generated object has nonzero bounding box
- no asset dimension is absurdly tiny or enormous by default
- no part is disconnected from the asset hierarchy
- joints reference valid parent/child parts
- revolute/continuous joints have a nonzero axis
- prismatic joints have a nonzero axis and plausible limits
- export-to-GLB smoke check can traverse the selected asset

Later validation can add approximate overlap detection:

- compute `Box3` per part
- identify severe unexplained part intersections
- allow intentional overlaps when tests include an allowance

## Prompt-Specific Tests

Port the Articraft idea of generated tests, but represent tests as declarative JSON:

```ts
type ManifestTest =
  | { type: "part_exists"; partName: string }
  | { type: "joint_exists"; jointName: string; jointType?: string }
  | { type: "part_count_min"; count: number }
  | { type: "material_exists"; materialName: string }
  | { type: "bbox_min"; target: "asset" | string; axis: "x" | "y" | "z"; min: number }
  | { type: "connected"; partA: string; partB: string }
```

The agent prompt should require the model to include tests for visible claims it made. The validator should run these tests and return failures as structured feedback.

## Agent Harness Plan

Build `agentLoop.ts` as a state machine:

```text
idle
-> compiling_prompt
-> requesting_model
-> parsing_candidate
-> validating_candidate
-> applying_candidate
-> rendering
-> ready | repairing | failed
```

The loop should:

1. Compile a system prompt from engine rules, schema, examples, and current scene summary.
2. Send user text and optional images to the provider.
3. Ask provider to return strict JSON matching `ManifestAssetPatch` or `ManifestAsset`.
4. Parse and validate output.
5. Build asset preview in an isolated candidate scene/group.
6. Run validation and prompt-specific tests.
7. If valid, commit into the scene store and render it.
8. If invalid, create a structured repair message and ask the model to revise.
9. Stop after a configurable turn cap.

Initial turn cap:

- 4 repair turns for UI responsiveness.
- Make this configurable in a settings panel later.

Important: never apply malformed model output directly to the main scene. Always stage, parse, validate, build, and then commit.

## OpenAI Client Plan

Create a narrow OpenAI client abstraction:

```ts
type OpenAIManifestClient = {
  generateAsset(request: AgentRequest): Promise<AgentResponse>
}
```

Initial implementation should support only OpenAI. Keep the interface narrow enough that another provider can be added later, but do not spend first-pass effort on provider-neutral routing, provider settings UI, or non-OpenAI request formats.

Environment key handling:

- Read the API key from `import.meta.env.VITE_OPENAI_API_KEY`.
- Document the expected root `.env` entry:

```sh
VITE_OPENAI_API_KEY=sk-...
```

- Ensure `.env` is ignored by git before relying on it.
- Do not log the key, echo it into the UI, include it in timeline events, or persist it elsewhere.
- If the key is missing, disable real generation and show a concise setup message in the chat panel.

OpenAI request behavior:

- Use direct browser `fetch` calls to the OpenAI API for the prototype, unless a later build explicitly adds the OpenAI JavaScript SDK.
- Use the configured OpenAI model from `engine/config/modelConfig.ts`; initial values are `model="gpt-5.5"`, `reasoningEffort="medium"`, `temperature=1.0`, and `maxOutputTokens=64_000`.
- Use structured output and require strict JSON matching the Manifest3D schema.
- Send user text, current selected asset JSON when editing, compact scene summary, schema summary, examples, and validation feedback.
- For image attachments, send browser data URLs or OpenAI-compatible image input objects, depending on the final API shape used during implementation.
- Use `AbortController` for cancellation once the UI exposes cancel.

Browser image handling:

- Prompt composer accepts image attachments.
- Convert images to data URLs or OpenAI-compatible payload objects.
- Store attachments in memory and optionally local IndexedDB later.
- Include image summaries in agent timeline.

## Agent Visibility Panel

The right panel should combine chat and build visibility.

Message types:

- user prompt
- assistant status
- agent step
- validation warning
- validation failure
- repair attempt
- final ready response

Timeline step examples:

- "Reading prompt and reference image"
- "Drafting asset schema"
- "Building candidate geometry"
- "Checking part hierarchy"
- "Testing articulations"
- "Repairing invalid joint limits"
- "Rendering validated asset"
- "Ready for export"

Panel behavior:

- Show chat bubbles similar to the reference image.
- Agent steps appear inline as compact status rows, not verbose logs.
- Keep latest active step visible while generation is running.
- Disable send during active run unless implementing cancellation.
- Include a cancel button once the loop supports abort signals.

## User Prompt And Edit Flow

Support two prompt modes:

- Create mode: no selected asset, prompt creates a new asset.
- Edit mode: selected asset exists, prompt modifies that asset.

Edit flow:

1. User selects asset in viewport.
2. Prompt composer indicates editing selected asset.
3. Agent receives current asset JSON plus user edit request.
4. Agent returns a patch or full replacement asset.
5. Validator stages the candidate.
6. If valid, replace selected asset in scene.

For the first implementation, use full replacement assets rather than JSON patch. Add patching later when the schema stabilizes.

## Real-Time Rendering During Agent Work

There are two levels of "real time":

Phase 1:

- Render only after each valid candidate is produced.
- Show textual steps while invalid/repair iterations happen.
- This is simpler and reliable.

Phase 2:

- Let the model stream partial structured updates.
- Render draft candidate geometry in ghost mode while validation is still running.
- Promote to solid only after validation passes.

Build Phase 1 first. It satisfies the user experience without making malformed partial output corrupt the viewport.

## GLB Export

Implement `exportGlb.ts`:

- Take selected `assetId`.
- Clone its Three.js group.
- Strip helper objects, selection outlines, axes, grid, and UI-only metadata.
- Use `GLTFExporter` with binary mode.
- Download as `<asset-name>.glb`.

Toolbar behavior:

- No selected asset: hide export button.
- Selected asset: show top-right `Export GLB` button inside viewport.
- While exporting: show small progress/disabled state.
- On failure: post an agent/status panel message.

## Selection And Viewport UX

Selection behavior:

- Single click selects the top-level asset under pointer.
- Selected asset gets subtle outline or glow.
- Click empty space clears selection.
- On selection, orbit target animates to asset center.
- Keep camera distance stable unless the selected object is outside current view; then refit gently.

Navigation:

- drag: orbit
- shift + drag: pan
- wheel up: zoom in
- wheel down: zoom out

Use pointer events on the canvas container. Avoid global event handlers except for keyboard modifiers.

## UI Implementation Phases

### Phase 1: App Shell And WebGPU Viewport

Tasks:

- Replace Vite template UI.
- Add WebGPU feature detection.
- Build full-screen frame layout matching the reference direction.
- Add right chat panel shell.
- Add empty Three.js WebGPU viewport with grid, lighting, axes gizmo, and responsive resize.
- Add a static demo asset built from hardcoded Manifest3D JSON.

Acceptance:

- `npm run build` passes.
- In a WebGPU-capable browser, the demo asset renders.
- In unsupported browsers, the app shows a clear unsupported state.
- Layout resembles the reference: dominant viewport, right chat panel, top Manifest3D brand chrome.

### Phase 2: Manifest3D Schema And Renderer

Tasks:

- Add Zod manifest schema.
- Add primitive geometry builders.
- Add asset builder from manifest JSON to Three.js group.
- Add scene store.
- Add selection/picking and camera recenter behavior.

Acceptance:

- Multiple hardcoded assets render from Manifest3D JSON.
- User can select assets.
- Camera target recenters on selection.
- Export button appears only when selected.

### Phase 3: Validation Harness

Tasks:

- Add schema validation.
- Add semantic validation.
- Add geometry bounds validation.
- Add declarative prompt test runner.
- Add structured validation report type.
- Render validation results in agent timeline.

Acceptance:

- Invalid manifest examples produce clear structured failures.
- Valid manifest examples commit to scene.
- Agent timeline can display validation/repair steps from deterministic fixture data and real validation reports.

### Phase 4: Agent Loop With Real OpenAI

Tasks:

- Add root `.env` support expectations for `VITE_OPENAI_API_KEY`.
- Add `src/engine/config/modelConfig.ts` with OpenAI defaults: `gpt-5.5`, reasoning effort `medium`, temperature `1.0`, and max output tokens `64_000`.
- Add the `OpenAIManifestClient` interface and implement the real browser OpenAI client.
- Ensure the OpenAI client reads model settings only from `modelConfig`.
- Implement full agent state machine using real OpenAI responses.
- Compile system prompt with schema, rules, current scene summary, and examples.
- Require strict JSON output.
- Add repair loop with validation feedback.
- Support create mode and selected-asset edit mode.
- Add prompt composer with image attachment UI.
- Include image attachments in OpenAI requests.
- Add unit tests for prompt compilation, OpenAI request construction with config values, missing-key behavior, response parsing, repair feedback construction, and agent-loop state transitions that can be tested without network calls.

Acceptance:

- With `VITE_OPENAI_API_KEY` set in the project-root `.env`, user can type a prompt and see step-by-step generation.
- OpenAI request parameters come from `modelConfig`; no model settings are hardcoded in the agent loop.
- With no key set, the UI clearly reports that OpenAI generation is unavailable and keeps the prebuilt demo scene usable.
- OpenAI candidate output is validated and rendered.
- User can select an asset and prompt an edit.
- The panel shows repair flow if OpenAI returns an invalid candidate first.
- Invalid outputs are repaired automatically within turn cap.
- Image attachments are included in request payload.
- No API keys are committed, logged, displayed, or stored outside Vite env access.

### Phase 5: GLB Export

Tasks:

- Add GLB exporter.
- Strip helpers from export.
- Add selected asset export toolbar.
- Test exported file in an external GLB viewer or by re-importing it locally.

Acceptance:

- Selected asset downloads as `.glb`.
- Export excludes grid, axes, selection outline, and chat UI.
- Exported GLB opens with expected geometry/materials.

### Phase 6: Polish And Reliability

Tasks:

- Add loading/working animation to viewport.
- Add selection outline.
- Add local scene persistence.
- Add cancellation.
- Add better mobile panel behavior.
- Add more geometry types and examples.
- Add approximate overlap detection.
- Add articulation preview controls for generated joints.

Acceptance:

- App feels like a coherent creation tool, not a demo.
- Agent failures are explainable to the user.
- User can create, edit, select, inspect, and export assets in one session.

## Prompt Compiler Requirements

All reusable prompt text must live in separate prompt files under:

```text
src/engine/agent/prompts/
```

Initial prompt files:

- `system.md`: core identity, schema contract, output rules, quality bar.
- `createAsset.md`: create-mode task instructions.
- `editAsset.md`: selected-asset edit instructions.
- `repairAsset.md`: validation-feedback repair instructions.
- `visibilitySteps.md`: short step labels/categories for the right-side agent timeline.

`promptCompiler.ts` should import these files as raw strings and compose them with runtime context such as schema summary, current scene summary, selected asset JSON, user prompt, reference-image metadata, examples, and validation feedback. Do not place long prompt strings directly inside `agentLoop.ts` or the OpenAI client.

The system prompt should instruct the model:

- Return only JSON.
- Use meters.
- Prefer multiple simple, well-named parts over one anonymous mesh.
- Include visible user-facing mechanisms as joints.
- Make parts physically connected.
- Avoid floating pieces.
- Avoid severe unintentional overlaps.
- Use plausible materials and colors.
- Include prompt-specific tests.
- Keep object scale plausible.
- If editing, preserve useful existing structure and only change requested aspects.

Include a compact schema summary and 2-3 high-quality examples. Keep examples small enough that browser requests stay responsive.

## Initial Example Assets

Add hardcoded examples to drive development before real LLM integration:

- utility crate with hinged lid and handles
- rolling tool cart with drawers and caster wheels
- maintenance barrier arm with pivoting striped arm

These match the UI reference and give selection/export tests meaningful content.

## Testing Plan

Use these checks during implementation:

- `npm run test`
- `npm run build`
- `npm run lint`
- Manual WebGPU browser test
- Playwright screenshot test later if browser tooling is added

Required unit tests for non-visual logic:

- schema accepts valid manifest
- schema rejects malformed geometry
- validation catches missing material references
- validation catches invalid joints
- asset builder creates selectable groups
- prompt compiler imports and combines prompt files correctly
- OpenAI request builder uses `modelConfig` values
- OpenAI request builder handles text plus image attachments
- missing API key returns a controlled unavailable state
- repair feedback preserves validation errors in a model-usable format
- agent loop transitions through request, parse, validate, repair, and commit states
- GLB export excludes helpers

Any future non-visual bug fix must add or update a regression test that captures the bug.

## Codex Implementation Notes

For later Codex build runs:

- Work only in `/Users/scott/Documents/Projects/Node/manifest3d`.
- Treat `/Users/scott/Documents/Projects/Python/articraft` as read-only reference.
- Use Articraft for concepts, not for copied Python code.
- Use real OpenAI integration for the first agent loop. Do not build a mock provider layer.
- Static fixtures are still appropriate for unit tests and hardcoded demo assets, but not as the runtime agent provider.
- Use only OpenAI for initial real LLM integration.
- Read the key from project-root `.env` as `VITE_OPENAI_API_KEY`.
- Put OpenAI model settings only in `src/engine/config/modelConfig.ts`; initial settings are `gpt-5.5`, reasoning effort `medium`, temperature `1.0`, and max output tokens `64_000`.
- Put reusable prompt text only in `src/engine/agent/prompts/` and import it into the prompt compiler.
- Never commit `.env`; verify `.env` is ignored before adding setup docs that rely on it.
- Implement unit tests alongside all non-visual engine/harness/validation code. Bug fixes in those areas require regression tests.
- Keep engine modules plain TypeScript and testable outside React.
- Do not add a backend unless explicitly requested.
- Do not implement WebGL fallback.
- After significant renderer changes, start the Vite dev server and verify the app in-browser with screenshots.

## Main Risks

- Frontend-only OpenAI calls expose `VITE_OPENAI_API_KEY` to the browser bundle. This is acceptable only for local/private prototype mode unless a backend is later added.
- Direct browser calls to OpenAI may hit CORS, model, or structured-output API constraints. Validate this early with the smallest possible request.
- OpenAI image input payloads may require format adjustments. Keep image handling isolated in the OpenAI client.
- Arbitrary model-generated TypeScript would be unsafe and brittle. Use JSON manifest generation instead.
- WebGPU support is browser-dependent. Unsupported browsers need a first-class blocked state.
- High-quality procedural geometry requires a good schema and examples. Start narrow and make validation strong.

## Definition Of Done For First Useful Prototype

The first useful prototype is complete when:

- The app opens to a full-screen Manifest3D creation workspace.
- WebGPU viewport renders at least one generated/manifest asset.
- User can prompt through the right panel using OpenAI via `VITE_OPENAI_API_KEY`.
- Agent steps are visible while generation runs.
- Valid candidate assets appear in the viewport.
- User can select an asset and orbit around its center.
- Selected asset can be exported as GLB.
- Unit tests, build, and lint pass.

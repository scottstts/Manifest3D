# Phase 3 Engine Design Choices

This captures the implementation decisions from the Contract V2 and validation-harness work that are not obvious from individual files.

## Contract V2

Manifest assets now use `schemaVersion: 2` at the asset level. Contract V2 removed `part.parentId` and legacy `tests`; parts are connected only through joints, and authored assertions live in `checks`.

Stable ids are the contract surface:

- parts: `partId`
- visuals: `visualId`
- joints: `jointId`
- controls: `controlId`
- materials: `materialId`

Names remain display labels. Checks, controls, and allowances should reference ids so repairs do not accidentally break exact relationships or UI articulation controls by renaming visible text.

## Joint-Driven Assembly

`src/engine/geometry/assetBuilder.ts` builds the Three.js hierarchy from joints:

- exactly one part has no parent joint and becomes the root
- every non-root part is attached through one parent joint
- `fixed` joints are the correct way to describe rigid mounts
- movable joints establish the rest hierarchy and can be scrubbed through runtime preview controls

Visual transforms are local to their owning part. Joint origins are treated as rest transforms from the parent part to the child part's local frame.

## Validation Signals

Validation reports now use `ValidationSignalBundle` as the source of truth. UI timeline rows are derived projections, not the validation model itself.

Signals carry severity, kind, code, blocking state, source, group, optional path, refs, check name, details, and dedupe key. This mirrors Articraft's compile-signal approach and is intended to feed Phase 4 repair feedback without reshaping validation output again.

## Baseline QC Versus Authored Checks

Baseline QC is harness-owned. Generated model checks should not duplicate structural or broad QC checks like one root, missing refs, mesh readiness, floating parts, or global overlap scans.

Implemented baseline QC includes:

- finite non-empty bounds
- mesh/export traversal readiness
- plausible asset scale
- physical support graph from the rooted body
- disconnected visual-island warning inside a part
- current-pose overlap failure unless scoped by allowance
- joint-origin distance warning

Authored checks are for prompt-critical exact claims:

- `part_exists`
- `joint_exists`
- `expect_contact`
- `expect_gap`
- `expect_overlap`
- `expect_within`

## Approximate Geometry Policy

The browser harness currently uses Three.js `Box3` bounds, projection intervals, and contact tolerances. This is intentional for Phase 3: it gives deterministic validation and report shape before adding heavier mesh-level collision logic.

Future mesh-level overlap/contact checks should keep the same signal and check schema so Phase 4 repair feedback does not need a second redesign.

## Allowances

Allowances are explicit authored declarations:

- `allow_overlap`
- `allow_isolated_part`

Overlap allowances are matched against reported part and optional visual pairs. Scoped visual-pair allowances are preferred. Allowances emit note signals so intentional exceptions remain visible to the agent and UI.

## Dev Fixtures

`src/engine/examples/rendererMockAssets.ts` is a visual-inspection fixture. It may be temporarily wired into startup through `src/app/appState.ts`, but it is not a product default and should remain unplugged by default.

`src/engine/examples/validationFixtures.ts` is test support and should stay aligned with Contract V2 whenever schema or validation semantics change.

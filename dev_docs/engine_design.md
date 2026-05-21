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
- material emission animations: `emissionAnimation.id`

Names remain display labels. Checks, controls, and allowances should reference ids so repairs do not accidentally break exact relationships or UI articulation controls by renaming visible text.

Current geometry descriptors include additive primitives for hard-surface objects plus the later quality primitives added after live headless stress runs:

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

`roundedBox` and `capsule` are part of the real asset contract, not test-only affordances. They exist because repeated generated assets needed softened housings, panels, handles, rails, grips, rounded pins, and padded supports without excessive stacks of boxes and cylinders. `roundedBox.radius` must stay within the Three geometry contract: no larger than half of the shortest size component.

Materials now carry an explicit `side` contract: `front`, `back`, or `double`. Runtime parsing defaults missing legacy material side values to `front`, but strict provider output requires the field. The renderer maps the value directly to Three material side behavior. Use `front` for ordinary closed solids and one-way details, `back` only for intentional interior-facing shells, and `double` for paper-thin, cutaway, or open surfaces that should remain visible from either side.

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
- movable-joint control coverage for articulated assets with multiple movable joints
- no-op control detection when authored control limits clamp to no actual joint motion
- material emission animation timing and visible-motion checks
- material-side intent checks for open/cutaway lathe surfaces

Authored checks are for prompt-critical exact claims:

- `part_exists`
- `joint_exists`
- `expect_material_side`
- `expect_contact`
- `expect_gap`
- `expect_overlap`
- `expect_within`

Open or cutaway `lathe` visuals are surface-side sensitive: if their sweep is partial or the revolved profile does not close back to the axis at both ends, validation requires a matching `expect_material_side` check for that visual. This does not force thickness or double-sided rendering. It forces the agent to choose whether the surface is intentionally one-sided or double-sided and to leave a testable design signal.

## Approximate Geometry Policy

The browser harness currently uses Three.js `Box3` bounds, projection intervals, and contact tolerances. This is intentional: it gives deterministic validation and report shape before adding heavier mesh-level collision logic.

There is one important refinement: hollow `torus` and `tube` visuals are decomposed into segment bounds for overlap checks. A whole-visual AABB treats a ring or grille like a filled disk, which caused false-positive guard-versus-rotor failures in live headless fan runs. Segment proxies preserve the same signal/check surface while letting hollow grilles, cages, rims, and rings protect moving internals without being treated as solid blockers.

Future mesh-level overlap/contact checks should keep the same signal and check schema so repair feedback does not need a second redesign.

## Allowances

Allowances are explicit authored declarations:

- `allow_overlap`
- `allow_isolated_part`

Overlap allowances are matched against reported part and optional visual pairs. Scoped visual-pair allowances are preferred. Allowances emit note signals so intentional exceptions remain visible to the agent and UI.

Overlap allowances are also a structure-level contract now, not just prompt guidance. Every `allow_overlap` must have a matching authored proof check for the same part pair. When the allowance names `visualAId` and `visualBId`, the proof check must reference that same visual pair through `expect_contact`, `expect_gap`, `expect_overlap`, or `expect_within`. Broad part-pair overlap allowances remain valid only when there is a matching proof check, but they emit a warning because they make accidental part-wide collisions harder to distinguish from intentional fitted contact.

Disconnected visual islands inside one part remain non-blocking warnings because generated hard-surface assets sometimes use panel/trim composition where a stricter rule could cause repair churn. Prompt guidance now asks the model to keep visuals within a part physically continuous or split separate mounted pieces into fixed child parts.

## Dev Fixtures

`src/engine/examples/rendererMockAssets.ts` is a visual-inspection fixture. It may be temporarily wired into startup through `src/app/appState.ts`, but it is not a product default and should remain unplugged by default.

`src/engine/examples/validationFixtures.ts` is test support and should stay aligned with Contract V2 whenever schema or validation semantics change.

# Engine Design

This document describes the implemented Manifest3D asset contract, builder, validation model, articulation semantics, and geometry-quality rules.

## Manifest Contract

Manifest assets use `schemaVersion: 2`. Static and articulated assets share one contract; there is no separate animated-asset schema.

Stable ids are the contract surface:

- parts: `partId`
- visuals: `visualId`
- joints: `jointId`
- controls: `controlId`
- materials: `materialId`
- material emission animations: `emissionAnimation.id`

Names are display labels. Checks, controls, and allowances reference ids so repairs do not break exact relationships or preview controls by renaming visible text.

Parts no longer use `parentId`, and legacy `tests` are not part of the contract. Parts are connected only through joints, and authored assertions live in `checks`.

Geometry descriptors include:

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
- `connectorTube`

`roundedBox` and `capsule` are first-class contract primitives for softened housings, panels, handles, rails, grips, pins, and padded supports. `roundedBox.radius` must not exceed half of the shortest size component.

Materials carry explicit `side`: `front`, `back`, or `double`. Runtime parsing defaults missing legacy values to `front`, while strict provider output requires the field. Use `front` for ordinary closed solids, `back` for intentional interior-facing shells, and `double` for paper-thin, cutaway, or open surfaces that must be visible from either side.

## Joint-Driven Assembly

`src/engine/geometry/assetBuilder.ts` builds the Three.js hierarchy from joints:

- exactly one part has no parent joint and becomes the root
- every non-root part attaches through one parent joint
- `fixed` joints describe rigid mounts
- `revolute`, `prismatic`, and `continuous` joints define articulated rest hierarchy

Visual transforms are local to their owning part. Joint origins are rest transforms from the parent part to the child part's local frame. Runtime joint poses apply at the joint group; part-local visual transforms remain unchanged.

## Articulation

`src/engine/geometry/jointPoses.ts` owns joint-pose behavior:

- movable-joint detection
- preview ranges and default values
- clamping and continuous-joint wrapping
- normalized axes
- revolute, prismatic, and continuous pose transforms
- generated sampled poses for validation
- manifest preview controls and fallback per-joint controls

The asset builder accepts optional `jointPoses`. Rest-pose building remains the default path, while validation and preview can build or update the same hierarchy at specific poses.

Preview state is runtime-only. `AppShell` stores joint pose values and material animation times by scene instance id, then passes them into the renderer. Scrubbing a joint or material animation does not mutate asset JSON, and the same saved asset can be previewed differently in different scene instances.

The preview panel appears only for selected instances with movable joints or material emission animation. Manifest `controls` define primary dials; uncovered movable joints receive fallback runtime dials. Multi-joint generated assets must declare controls that cover their movable joints, so mechanism behavior is intentional for preview and dynamic GLB export.

Limited revolute and prismatic controls ping-pong during playback. Continuous controls wrap through a full turn. Animation is driven from `AppShell` with `requestAnimationFrame`, not hidden inside asset construction.

## Material Emission Animation

Material emission animation lives on the glowing material. It uses keyframes for emission color, intensity, loop behavior, and step or linear interpolation. It is previewed as per-instance runtime state and validated as part of the same Manifest3D asset contract.

Visible lights, screens, LEDs, flashing beacons, and color-switching indicators should use material emission animation rather than scene lights. Dynamic GLB export handles emission animation separately from joint animation.

## Validation Signals

Validation reports use `ValidationSignalBundle` as the source of truth. UI timeline rows and repair feedback are projections.

Signals carry severity, kind, code, blocking state, source, group, optional path, refs, check name, details, and dedupe key. The signal surface is shared across schema validation, structure validation, baseline QC, authored checks, sampled-pose validation, build checks, and export readiness.

## Baseline QC And Authored Checks

Baseline QC is harness-owned. Generated authored checks should not duplicate broad structural checks like one root, missing refs, mesh readiness, floating parts, or global overlap scans.

Implemented baseline QC includes:

- finite non-empty bounds
- mesh/export traversal readiness
- plausible asset scale
- physical support graph from the rooted body
- disconnected visual-island warnings inside a part
- current-pose overlap failures unless scoped by allowance
- joint-origin distance warnings
- movable-joint control coverage for multi-joint articulated assets
- no-op control detection
- material emission animation timing and visible-motion checks
- material-side intent checks for open/cutaway lathe surfaces
- connectorTube endpoint support in the physical support graph
- shape-aware relation metrics shared by overlap, contact, support, and probes

Authored checks are for prompt-critical exact claims:

- `part_exists`
- `joint_exists`
- `expect_material_side`
- `expect_contact`
- `expect_gap`
- `expect_overlap`
- `expect_within`

Open or cutaway `lathe` visuals are surface-side sensitive. If their sweep is partial or the revolved profile does not close back to the axis at both ends, validation requires a matching `expect_material_side` check. This preserves intentional one-sided and double-sided surfaces while making the render choice testable.

## Sampled-Pose Validation

Validation has a `sampled_poses` stage between authored rest-pose checks and export readiness.

Rest-pose authored checks run through `runPromptChecks` by default. Checks with `check.pose` run only when the requested pose is applied.

Sampled-pose validation combines generated samples from manifest preview controls and authored samples from `check.pose`. For each sample, validation builds the asset with those joint values, runs sampled-pose overlap QC, and runs authored checks targeting that pose.

Generated samples follow controls rather than sampling every movable joint independently. This matches preview/export behavior for linked mechanisms and avoids impossible single-joint poses in paired or grouped mechanisms.

Sampled-pose overlap QC suppresses world-frame AABB artifacts when two parts have the same relative transform as the rest pose. Relative-motion pairs are still checked normally, so true articulated collisions remain blocking.

`check.pose` references movable joint ids and uses native joint units: radians for `revolute` and `continuous`, meters for `prismatic`. Invalid pose specs produce `sampled_pose_invalid` signals instead of crashing validation.

## Geometry Relation Metrics

The browser harness uses deterministic approximate geometry: Three.js bounds, projection intervals, relation proxies, and tolerances. Mesh-level collision is not part of the current engine.

`src/engine/geometry/relationMetrics.ts` creates shared visual-pair proxies for overlap, contact, support, and probe reporting. Long solid visuals are subdivided along their dominant local axis so rotated booms, rails, beams, axles, and trusses do not behave like filled swept AABBs. `torus`, `tube`, and `connectorTube` use polyline segment proxies so rings, grilles, cages, and cables are not treated as filled disks.

`expect_contact` bounds hidden penetration. Ordinary contact allows only a small seating tolerance. Intentional captured or seated fits should set `expect_contact.maxPenetration` or use `expect_gap.maxPenetration` with a scoped `allow_overlap`.

Failed sampled-pose relation probes are measured in the failing pose when the signal carries joint values, so repair feedback reports the geometry that actually failed.

Future mesh-level checks should keep the same signal and check schema.

## Allowances

Allowances are explicit authored declarations:

- `allow_overlap`
- `allow_isolated_part`

Overlap allowances match reported part pairs and optional visual pairs. Scoped visual-pair allowances are preferred, and every `allow_overlap` must have a matching authored proof check for the same part pair. When the allowance names `visualAId` and `visualBId`, the proof check must reference the same visual pair through `expect_contact`, `expect_gap`, `expect_overlap`, or `expect_within`.

Broad part-pair overlap allowances remain valid only with proof, but they warn because they can hide accidental collisions. Authored relation checks between multi-visual parts also warn when they omit exact visual ids.

Disconnected visual islands inside one part remain non-blocking warnings. Generated assets may use panel and trim composition, but physically separate mounted pieces should be split into fixed child parts.

`allow_isolated_part` is narrow. Mechanical/support roles such as wheels, hinges, controls, housings, bases, handles, fasteners, and mechanisms must establish visible support through contact, fixed mounting, or connectorTube endpoints.

Sampled-pose overlap QC reuses authored overlap allowances. Allowed sampled overlaps emit note signals so intentional intersections stay visible to the repair loop and UI.

## Connector Tubes

`connectorTube` represents flexible chains, cables, hoses, ropes, straps, tethers, wires, hangers, and suspension cables whose endpoints belong to parts. Endpoint positions are local to referenced parts. The builder regenerates the tube from current endpoint part transforms for validation and preview, so the visual uses an empty or identity transform.

Connector tubes use subdivided overlap proxies. Only endpoint-adjacent chunks can ignore contact with the referenced endpoint parts. Overlap with unrelated obstructions remains a validation failure.

Dynamic GLB export preserves connector endpoint motion through morph-target weight tracks on connector meshes.

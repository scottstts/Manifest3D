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
- disconnected visual-island checks inside a part; mechanically critical roles are blocking
- current-pose overlap failures unless covered by exact bounded fitted-contact proof or scoped allowance
- joint-origin distance warnings
- close visible mechanical-fit checks for movable parent/child joint pairs
- movable-joint control coverage for multi-joint articulated assets
- no-op control detection
- material emission animation timing and visible-motion checks
- material-side intent checks for open/cutaway lathe surfaces
- connectorTube endpoint support in the physical support graph
- mesh-refined relation metrics shared by overlap, contact, support, and probes

Authored checks are for prompt-critical exact claims:

- `part_exists`
- `joint_exists`
- `expect_material_side`
- `expect_contact`
- `expect_path_contacts`
- `expect_gap`
- `expect_overlap`
- `expect_within`

CAD-like/mechanical prompts also get structural relation-coverage checks. Prompt-critical routed paths such as belts, chains, tracks, hoses, cables, ropes, straps, and wires need a clearly named path-like part plus `expect_path_contacts` evidence to at least two supports unless they are simple endpoint-routed connectorTube-style cables/hoses/ropes/straps/wires. Wrapped, wound, taut, or support-riding path prompts still require path-contact evidence even if the visual could be represented with connectorTube endpoints. Part identity for this coverage comes from part id, name, and role; descriptions and visual labels are not enough because they often mention related neighbors. Support components such as belt pulleys, chain sprockets, and bearing shafts should be classified by the support/rotary component, not as the routed belt/chain/path. Rods and linkages need exact relation evidence at both ends. Prompt-critical guided and rotary components such as pistons, sliders, shafts, cranks, gears, pulleys, sprockets, hubs, bearings, and wheels must be represented as named parts; visual-only labels do not satisfy component presence. Those parts also need at least one fitted-interface relation check. For multi-visual mechanical relationships, broad part-level checks are not counted as coverage; exact visual ids are required where either part has multiple visuals.

Mechanical relation coverage also evaluates target quality, not just relation count. Routed paths that mention pulleys, sprockets, wheels, gears, rims, or rollers must use `expect_path_contacts` against those rotary support targets. Couplers in prompts that combine guided movers with rotary interfaces must prove relation evidence to both endpoint categories, such as piston/wrist-pin side plus crank/crank-pin side. Guided movers such as pistons, sliders, plungers, sleeves, and valves need evidence to a constraining guide, liner, cylinder, rail, sleeve, housing, or support rather than only to a rod or loose neighbor. When the prompt asks those guided movers to slide, stroke, reciprocate, or couple into a crank/linkage mechanism, they also need a prismatic joint whose parent is the guide/cylinder/rail/housing/support. Linked mechanical prompts such as crank, timing, belt/chain-driven, gear-train, drivetrain, or linkage mechanisms need at least one multi-joint control when multiple movable joints exist, so preview/export expresses coupled motion instead of unrelated one-joint dials. For linked guided mechanisms, that control must bind at least one guided prismatic joint and one rotary joint together. Those linked moving mechanisms also need pose-specific relation evidence at a sampled driven pose for the fitted interfaces that must remain coupled through motion: rod endpoints, guided movers in guides, and routed paths seated on their supports.

Rigid couplers such as connecting rods, pushrods, tie rods, link arms, and linkages must read as rigid bars with bearing eyes, pins, sockets, clevises, or similar end features. `connectorTube` is reserved for flexible endpoint-routed cables, hoses, ropes, straps, tethers, and wires. A coupler part whose only visuals are connectorTubes fails mechanical relation coverage because it can look connected while bypassing the rigid linkage shape expected for CAD-like motion-transfer parts.

Linked guided-to-rotary mechanisms also require the rigid coupler to participate in the motion model. In prompts that combine guided movers with cranks, shafts, wheels, gears, sprockets, or pulleys, a rod/linkage with only fixed joints fails mechanical relation coverage. The asset should include at least one movable pivot joint on that coupler at a pin, bearing eye, clevis, socket, wrist pin, crank pin, or journal endpoint, and the ordinary multi-joint control coverage then keeps that pivot grouped with the related guided and rotary joints.

Cutaway mechanical housings must be represented as actual open clearance geometry, not broad solids that rely on overlap repair later. Blocks, heads, covers, guards, frames, rails, walls, cases, and shells around exposed mechanisms should be split into windows, posts, collars, brackets, flanges, separated panels, or open shells around prompt-critical moving parts and their sampled swept volume. If validation reports collisions between a static enclosure and moving internals, repair feedback should push the model to open or split the static enclosure before adding allowances or moving the mechanism into loose-looking positions.

Open or cutaway `lathe` visuals are surface-side sensitive. If their sweep is partial or the revolved profile does not close back to the axis at both ends, validation requires a matching `expect_material_side` check. This preserves intentional one-sided and double-sided surfaces while making the render choice testable.

Missing material-side checks remain blocking validation failures, but they do not stop build, baseline QC, authored checks, sampled-pose validation, or export-readiness checks. Renderer-facing hygiene failures should not hide physical relation failures from the same candidate attempt.

Mechanical relation-coverage failures are also build-permissive. They remain blocking for acceptance, but validation continues through build, baseline QC, authored checks, sampled-pose validation, and export readiness so a candidate that is missing relation evidence and physically colliding surfaces both problems in one repair turn.

## Sampled-Pose Validation

Validation has a `sampled_poses` stage between authored rest-pose checks and export readiness.

Rest-pose authored checks run through `runPromptChecks` by default. Checks with `check.pose` run only when the requested pose is applied.

Sampled-pose validation combines generated samples from manifest preview controls and authored samples from `check.pose`. For each sample, validation builds the asset with those joint values, runs sampled-pose overlap QC, and runs authored checks targeting that pose.

Generated samples follow controls rather than sampling every movable joint independently. This matches preview/export behavior for linked mechanisms and avoids impossible single-joint poses in paired or grouped mechanisms.

Multi-joint non-wrapping controls are sampled through intermediate phases across the control range, not only at end stops. This catches coupled-mechanism failures in quarter-cycle and half-cycle poses for crank/rod/piston, belt, chain, linkage, drivetrain, and gear-train controls while preserving the smaller sample set for independent one-joint controls.

Sampled-pose overlap QC suppresses world-frame AABB artifacts when two parts have the same relative transform as the rest pose. It also skips visual pairs that already overlap in the current/rest pose, because baseline QC owns those failures. Relative-motion pairs that create new sampled-pose collisions are still checked normally, so true articulated collisions remain blocking. If a sampled-pose overlap has a pose-specific exact visual-pair proof check with bounded penetration, validation emits a fitted-contact note instead of a collision failure.

`check.pose` references movable joint ids and uses native joint units: radians for `revolute` and `continuous`, meters for `prismatic`. Invalid pose specs produce `sampled_pose_invalid` signals instead of crashing validation.

## Geometry Relation Metrics

`src/engine/geometry/relationMetrics.ts` keeps relation proxies as a deterministic broad phase, then refines candidate pairs through `src/engine/geometry/meshRelations.ts`. The narrow phase builds world-space mesh BVHs with `three-mesh-bvh`; surface intersections and closed-mesh containment are treated as real overlap, and exact closest mesh distance is used for contact/support checks when a broad-phase pair is overlapping or close enough to affect validation thresholds. Pure overlap scans use intersection-only mesh refinement and avoid closest-distance work for separated candidates. Proxy overlap depth and volume remain reporting approximations after the mesh decision has confirmed a collision.

Mesh BVHs are constructed lazily per visual pair, and baseline QC shares a mesh relation index plus one relation-proxy set across support, visual-island, current-overlap, and movable-fit checks for one built asset. Authored checks and sampled-pose validation also reuse relation proxies within one built pose. Do not eagerly rebuild BVHs or proxies for each part pair/check; large mechanical assets can contain enough visuals that repeated exact-distance setup dominates validation.

Long solid visuals are still subdivided along their dominant local axis before the mesh phase so rotated booms, rails, beams, axles, and trusses do not behave like filled swept AABBs. `torus`, `tube`, and `connectorTube` use polyline segment proxies so rings, grilles, cages, and cables are not treated as filled disks. Open or cutaway `lathe` visuals use capped surface patch proxies, so hollow sleeves, cases, bowls, and cutaway shells do not collide with valid internals merely because their broad bounds enclose empty space. The relation-proxy segment count must stay independent from authored render segment count; high visual smoothness should not create thousands of broad-phase validation proxies. Closed full-sweep lathe profiles that return to the axis at both ends remain closed collision surfaces for containment checks.

Same-part visual-island connectivity uses broad bounds/tolerance first and mesh intersection only when bounds overlap; it intentionally avoids exact closest-distance work for every near visual pair. For `mechanism`, `support`, `wheel`, `hinge`, `control`, and `fastener` parts, disconnected visual islands are blocking because they read as loose mechanical pieces. Less critical roles keep the warning behavior so composed housings and decorative trim can still be repaired without overfitting.

Movable joints now need a close visible parent/child fit. Validation first uses the same cheap support predicate as floating-part reachability, and only computes exact closest mesh distance when it needs failure details. Detached movable joints fail, pushing generated CAD-like assets toward bearings, collars, hinge barrels, guides, pins, sockets, brackets, and flanges instead of visually loose motion groups.

`expect_contact` and `expect_within` can bound hidden penetration. Ordinary contact allows only a small seating tolerance. Intentional captured, seated, or guided fits should set exact visual ids plus `expect_contact.maxPenetration`, `expect_path_contacts.maxPenetration`, `expect_gap.maxPenetration`, or `expect_within.maxPenetration`. Current-pose and sampled-pose overlap QC treats the same exact visual-pair overlap as a fitted-contact note when the penetration is within that bound. This keeps rods, bearings, collars, sliders, pistons in liners, belts, and seated trim from being forced apart just to pass global overlap QC. Use scoped `allow_overlap` for intentional overlap exceptions that are not bounded fitted contacts.

Use `maxPenetration: 0` only for genuine no-penetration surface touch. Captured bearings, collars, liners, sleeves, rails, slots, and seated wrapped paths usually require a small positive bound so validation can distinguish plausible fitted overlap from broad accidental collision.

Repair feedback classifies inserted-support fits separately from generic clearance failures. Liners, bushings, bearings, collars, sleeves, shafts, hubs, pins, journals, and guide rails seated in blocks, heads, cases, housings, brackets, sockets, mounts, or supports should usually be fixed with exact bounded `expect_within` or `expect_contact` proof when the insertion is intentional. If the overlapping outer part is broad decorative enclosure geometry rather than a fitted support, the repair should open, split, shrink, or relocate that static geometry around the mechanism.

Failed sampled-pose relation probes are measured in the failing pose when the signal carries joint values, so repair feedback reports the geometry that actually failed.

Future relation improvements should keep the same signal and check schema.

## Allowances

Allowances are explicit authored declarations:

- `allow_overlap`
- `allow_isolated_part`

Overlap allowances match reported part pairs and optional visual pairs. Scoped visual-pair allowances are preferred, and every `allow_overlap` must have a matching authored proof check for the same part pair. When the allowance names `visualAId` and `visualBId`, the proof check must reference the same visual pair through `expect_contact`, `expect_path_contacts`, `expect_gap`, `expect_overlap`, or `expect_within`. Allowances are not required for exact visual-pair fitted contacts whose `expect_contact`, `expect_path_contacts`, `expect_gap`, or `expect_within` check already bounds the measured penetration.

Broad part-pair overlap allowances remain valid only with proof, but they warn because they can hide accidental collisions. Authored relation checks between multi-visual parts also warn when they omit exact visual ids.

Disconnected visual islands inside one part remain non-blocking warnings only for non-mechanical roles. Mechanically critical roles must read as physically continuous, or separate mounted pieces should be split into fixed child parts.

`allow_isolated_part` is narrow. Mechanical/support roles such as wheels, hinges, controls, housings, bases, handles, fasteners, and mechanisms must establish visible support through contact, fixed mounting, or connectorTube endpoints.

Sampled-pose overlap QC reuses authored overlap allowances and pose-specific bounded fitted-contact proof. Allowed or proven sampled overlaps emit note signals so intentional intersections stay visible to the repair loop and UI.

## Connector Tubes

`connectorTube` represents flexible chains, cables, hoses, ropes, straps, tethers, wires, hangers, and suspension cables whose endpoints belong to parts. Endpoint positions are local to referenced parts. The builder regenerates the tube from current endpoint part transforms for validation and preview, so the visual uses an empty or identity transform.

Connector tubes use subdivided overlap proxies. Only endpoint-adjacent chunks can ignore contact with the referenced endpoint parts. Overlap with unrelated obstructions remains a validation failure.

Dynamic GLB export preserves connector endpoint motion through morph-target weight tracks on connector meshes.

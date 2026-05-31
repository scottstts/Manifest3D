# Phase 7 Articulation Design Choices

Phase 7 makes generated mechanisms inspectable and validatable beyond their rest pose. These notes capture the design decisions that are not obvious from individual files.

## One Manifest Contract

Static and articulated assets still use the same Manifest3D asset contract. There is no separate "animated asset" schema.

The difference is how the existing joint fields are used:

- static assets use `fixed` joints to assemble a rigid part tree
- articulated assets use `revolute`, `prismatic`, or `continuous` joints with axis and limit data
- `controls` may group one or more movable joints under a single preview dial
- material emission animation lives on the material that glows, using emission keyframes rather than scene lights
- material side lives on the material as an authored render contract, with `expect_material_side` checks for prompt-critical open or cutaway surfaces
- pose-specific authored checks may add `check.pose` when a mechanism needs validation away from rest pose

This keeps the renderer, validator, export path, and repair loop on one contract surface. A static chair, a hinged box, and a police light bar are all Manifest3D assets; the hinged box uses movable joints, while the light bar uses material emission animation.

## Joint Pose Semantics

`src/engine/geometry/jointPoses.ts` owns runtime joint-pose behavior. It centralizes:

- movable-joint detection
- preview ranges and default values
- clamping and continuous-joint wrapping
- normalized joint axes
- applying revolute, prismatic, and continuous pose transforms
- generated sampled poses for validation
- manifest-level preview controls and fallback per-joint controls

The asset builder now accepts optional `jointPoses`. This keeps rest-pose building as the default path while allowing validation and preview to build or update the same hierarchy at specific poses.

Joint transforms are applied at the joint group. Part-local visual transforms remain unchanged. This preserves the Phase 3 joint-driven assembly model: a joint origin defines the parent-to-child frame, and the pose value adds motion around or along that joint axis.

## Runtime Preview State

Animation preview is UI/runtime state, not persisted asset state.

`AppShell` stores joint pose values and material animation times by scene instance id, then passes them into the WebGPU renderer. The renderer applies joint values to already-built joint groups through `applyBuiltManifestJointPoses` and applies material emission state through `applyBuiltManifestMaterialAnimations`.

This means:

- scrubbing a joint does not mutate the asset JSON
- scrubbing a material emission animation does not mutate the asset JSON
- the same saved asset can be previewed differently in different scene instances
- export still uses the canonical asset; dynamic GLB export adds generated motion clips instead of exporting the current preview pose
- resetting the preview simply removes per-instance pose state

The preview panel appears only for selected instances that have movable joints or material emission animation. If the asset declares `controls`, those controls define the joint dials; uncovered movable joints still get fallback individual dials at runtime. Material emission animations appear in the same panel as timeline controls. Validation is stricter for generated multi-joint assets: when more than one movable joint exists, the manifest must declare controls that cover those movable joints. This keeps the authored mechanism intentional for preview and dynamic GLB export instead of relying on accidental fallback dials.

Limited revolute/prismatic controls ping-pong during playback; continuous controls wrap through a full turn.

## Demand-Driven Rendering

The app still uses demand-driven rendering. Joint preview and material emission preview changes explicitly invalidate the Fiber scene after poses or material values are applied.

Animation is driven from `AppShell` with `requestAnimationFrame`, not hidden inside the Three object builder. This keeps animation lifecycle tied to UI state and avoids making asset construction itself stateful.

## Rest-Pose Versus Sampled-Pose Validation

Validation now has a distinct `sampled_poses` stage between authored rest-pose checks and export readiness.

Rest-pose authored checks continue to run through `runPromptChecks` by default. Checks that include `check.pose` are intentionally excluded from the rest-pose pass and are run only when the requested pose is applied.

Sampled-pose validation combines two sources:

- generated samples from manifest preview controls, such as hinge limits, slider limits, paired steering controls, and continuous quarter-turns
- authored samples from `check.pose`

For each sample, validation builds the asset with those joint values, runs sampled-pose overlap QC, then runs any authored checks that target that same pose.

Generated samples intentionally follow controls rather than sampling every movable joint independently. This matches the UI and dynamic-export contract for linked mechanisms and avoids forcing repairs for impossible single-joint poses, such as one steering knuckle turning while the paired steering control would move both.

Sampled-pose overlap QC is frame-invariant for rigidly shared motion. If two parts have the same relative transform in a sampled pose as they had at rest, a new overlap finding for that pair is treated as an artifact of world-axis proxy boxes and is suppressed unless the same visual pair already overlapped at rest. Relative-motion pairs are still validated, so true articulated collisions remain blocking.

The report can now distinguish failures such as:

- a rest-pose overlap
- an overlap that appears only while a joint is sampled
- an invalid authored pose reference
- an exact prompt check that fails only at an open, extended, turned, or rotated pose

## Authored Pose Checks

`check.pose` is optional in the runtime schema. It references movable joint ids and gives values in the joint's native unit:

- radians for `revolute` and `continuous`
- meters for `prismatic`

Pose values are normalized before validation. Invalid pose specs, such as missing joints or fixed-joint references, produce `sampled_pose_invalid` signals rather than crashing validation.

The OpenAI structured-output contract needs stricter shape than the runtime Zod schema. For strict structured outputs, optional object keys cannot simply appear in `properties` without being listed in `required`. The contract therefore represents each check as two variants: one without `pose`, and one with required `pose`. When `pose` is emitted through the OpenAI contract, its `name` is also required.

The local runtime parser remains more permissive where useful, so existing hand-authored or persisted manifests can omit optional display fields.

## Overlap Fidelity

Overlap/contact validation is still based on bounds, projection intervals, and deterministic tolerances, not a full mesh collision library. Phase 7 originally extended when checks run rather than replacing the geometric collision primitive.

The current implementation adds a targeted refinement for hollow protective shapes: `torus` and `tube` visuals are split into segment bounds before overlap testing. This prevents circular grilles, cages, rims, and ring guards from behaving like filled disks while still reporting real material intersections when another visual crosses the ring or tube body.

The relation proxy layer has since been generalized: long solid visuals are also subdivided along their dominant local axis before overlap/contact/support checks. This keeps rotated booms, rails, beams, axles, and truss members from behaving like their whole swept AABB is solid. All of these approximate checks now flow through the same visual-pair relation metrics used by contact checks and probe reports, which reduces overlap-versus-contact repair oscillation.

Failed sampled-pose relation probes are measured in the failing pose when the signal carries joint values. This keeps repair feedback from reporting rest-pose distances for a failure that only exists while the mechanism is moved.

That choice is intentional:

- sampled-pose validation needed deterministic report shape first
- bounds-level checks are already integrated with allowances and repair feedback
- hollow ring/tube segment proxies solve a real generated-asset failure mode without adding a heavy collision dependency
- mesh-level collision can still be added later behind the same signal/check surfaces

The plan allowed mesh-level checks "if needed"; the implementation still avoids that heavier path because the immediate live failure modes were lack of pose sampling and overly broad hollow-shape bounds, not a general need for per-triangle collision.

## Allowances In Sampled Poses

Sampled-pose overlap QC reuses authored overlap allowances. Allowed sampled overlaps emit note signals so the repair loop and UI can still see intentional intersections.

This is deliberately conservative: allowances remain explicit, scoped declarations. Sampled-pose validation does not silently ignore overlaps just because an asset is mechanical.

Contact proof checks now distinguish touch from deep penetration. `expect_contact.maxPenetration` can intentionally bound seated/captured fits, while ordinary surface contact should use zero or the small default. Deep overlap should remain an overlap allowance plus bounded proof, not an accidental pass through contact distance.

## Repair Feedback And Timeline

Repair feedback now understands `sampled_poses` and `sampled_pose_overlap` as first-class validation evidence. The guidance tells the model to repair joint origin, axis, limits, child placement, or clearance instead of only tweaking rest-pose geometry.

Timeline copy also distinguishes sampled-pose failures from rest-pose validation. The user should be able to tell whether the asset failed while assembled normally or while a mechanism was moved.

## Prompt Contract

Prompt docs now ask the model to include pose-specific checks for primary mechanisms: lids, drawers, wheels, hinges, sleeves, retainers, handles, and controls. They also tell the model to use material `emission` and `emissionAnimation` for prompt-critical visible lights, flashing beacons, LEDs, screens, and color-switching indicators. Material `side` is now part of the same prompt contract: closed solids normally use `front`, intentional interior shells may use `back`, and paper-thin/open surfaces that need two-sided visibility use `double`; prompt-critical open/cutaway lathe visuals should include `expect_material_side`.

This is a prompt-quality requirement, not a new schema mode. If the prompt asks for a static object, the model should not invent pose checks or controls. If the prompt asks for a mechanism, the model should express the mechanism with movable joints, appropriate control grouping, and targeted pose checks.

## Tests

Phase 7 added coverage for:

- building an asset at a supplied joint pose
- pose-specific authored checks running in `sampled_poses`
- generated sampled-pose overlaps being reported separately from rest-pose overlaps
- multi-joint movable assets requiring authored control coverage
- hollow torus/tube overlap checks not filling the center void
- validation timeline/stage ordering including sampled poses
- grouped preview controls and per-joint fallback controls
- generated sampled poses coming from controls for linked mechanisms
- no-op controls whose limits clamp to no joint motion
- material emission schema, preview, validation, and export behavior
- provider structured-output compatibility for the response schema

The structured-output compatibility tests are important because providers can reject an invalid response schema before any candidate is generated. That failure does not exercise normal candidate parsing or validation, so it needs its own contract guard.

## Current Limits

The system does not yet provide:

- physics simulation
- automatic motion planning
- general mesh-level collision/contact
- persisted preview poses
- export of a chosen animated pose
- material animation properties beyond emission color/on-off/intensity

Those are future extensions. The current boundary is deterministic joint articulation, material-emission animation preview, sampled-pose validation, and dynamic GLB export for the supported animation surfaces inside the existing Manifest3D pipeline.

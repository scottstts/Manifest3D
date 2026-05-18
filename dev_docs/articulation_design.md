# Phase 7 Articulation Design Choices

Phase 7 makes generated mechanisms inspectable and validatable beyond their rest pose. These notes capture the design decisions that are not obvious from individual files.

## One Manifest Contract

Static and articulated assets still use the same Manifest3D asset contract. There is no separate "animated asset" schema.

The difference is how the existing joint fields are used:

- static assets use `fixed` joints to assemble a rigid part tree
- articulated assets use `revolute`, `prismatic`, or `continuous` joints with axis and limit data
- `controls` may group one or more movable joints under a single preview dial
- pose-specific authored checks may add `check.pose` when a mechanism needs validation away from rest pose

This keeps the renderer, validator, export path, and repair loop on one contract surface. A static chair and a hinged box are both Manifest3D assets; the hinged box simply has movable joints, optional control grouping, and pose-aware checks.

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

Joint preview is UI/runtime state, not manifest data and not persisted asset state.

`AppShell` stores preview values by scene instance id, then passes them into the WebGPU renderer. The renderer applies those values to already-built joint groups through `applyBuiltManifestJointPoses`.

This means:

- scrubbing a joint does not mutate the asset JSON
- the same saved asset can be previewed differently in different scene instances
- export still uses the canonical asset unless a future phase explicitly adds pose export
- resetting the preview simply removes per-instance pose state

The preview panel appears only for selected instances that have movable joints. If the asset declares `controls`, those controls define the dials; uncovered movable joints still get fallback individual dials. This supports linked controls such as all wheel-spin joints under one dial while keeping independent hinges separate. Limited revolute/prismatic controls ping-pong during playback; continuous controls wrap through a full turn.

## Demand-Driven Rendering

The app still uses demand-driven rendering. Joint preview changes explicitly invalidate the Fiber scene after poses are applied.

Animation is driven from `AppShell` with `requestAnimationFrame`, not hidden inside the Three object builder. This keeps animation lifecycle tied to UI state and avoids making asset construction itself stateful.

## Rest-Pose Versus Sampled-Pose Validation

Validation now has a distinct `sampled_poses` stage between authored rest-pose checks and export readiness.

Rest-pose authored checks continue to run through `runPromptChecks` by default. Checks that include `check.pose` are intentionally excluded from the rest-pose pass and are run only when the requested pose is applied.

Sampled-pose validation combines two sources:

- generated samples from movable joints, such as hinge limits, slider limits, and continuous quarter-turns
- authored samples from `check.pose`

For each sample, validation builds the asset with those joint values, runs sampled-pose overlap QC, then runs any authored checks that target that same pose.

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

Phase 7 keeps the existing bounds-level overlap/contact implementation. It extends when checks run, not the geometric collision primitive itself.

That choice is intentional for this phase:

- sampled-pose validation needed deterministic report shape first
- bounds-level checks are already integrated with allowances and repair feedback
- mesh-level collision can be added later behind the same signal/check surfaces

The plan allowed mesh-level checks "if needed"; the implementation did not introduce that heavier path because the immediate failure mode was lack of pose sampling, not lack of a mesh collision library.

## Allowances In Sampled Poses

Sampled-pose overlap QC reuses authored overlap allowances. Allowed sampled overlaps emit note signals so the repair loop and UI can still see intentional intersections.

This is deliberately conservative: allowances remain explicit, scoped declarations. Sampled-pose validation does not silently ignore overlaps just because an asset is mechanical.

## Repair Feedback And Timeline

Repair feedback now understands `sampled_poses` and `sampled_pose_overlap` as first-class validation evidence. The guidance tells the model to repair joint origin, axis, limits, child placement, or clearance instead of only tweaking rest-pose geometry.

Timeline copy also distinguishes sampled-pose failures from rest-pose validation. The user should be able to tell whether the asset failed while assembled normally or while a mechanism was moved.

## Prompt Contract

Prompt docs now ask the model to include pose-specific checks for primary mechanisms: lids, drawers, wheels, hinges, sleeves, retainers, handles, and controls.

This is a prompt-quality requirement, not a new schema mode. If the prompt asks for a static object, the model should not invent pose checks or controls. If the prompt asks for a mechanism, the model should express the mechanism with movable joints, appropriate control grouping, and targeted pose checks.

## Tests

Phase 7 added coverage for:

- building an asset at a supplied joint pose
- pose-specific authored checks running in `sampled_poses`
- generated sampled-pose overlaps being reported separately from rest-pose overlaps
- validation timeline/stage ordering including sampled poses
- grouped preview controls and per-joint fallback controls
- OpenAI strict structured-output compatibility for the response schema

The strict structured-output test is important because OpenAI can reject an invalid response schema before any candidate is generated. That failure does not exercise normal candidate parsing or validation, so it needs its own contract guard.

## Current Limits

The system does not yet provide:

- physics simulation
- automatic motion planning
- mesh-level collision/contact
- persisted preview poses
- export of a chosen animated pose

Those are future extensions. The Phase 7 boundary is deterministic articulation preview plus sampled-pose validation inside the existing Manifest3D pipeline.

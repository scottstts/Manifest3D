# Export Design

This document describes the implemented GLB export path for Manifest3D assets.

## Export Scope

GLB export is a Create-workspace action. The top-chrome button remains visible globally, but it is enabled only when the active workspace is `create` and the Create viewport has an asset loaded.

Compose selections do not export. Compose instances carry arrangement transforms and multi-asset context, which need a separate export contract.

Export starts from the viewed Create Manifest3D asset JSON, not from the live React Three scene. `exportGlb.ts` rebuilds the asset into an isolated Three group, clones that group for export, and disposes the intermediate build. Renderer-only objects never enter the exported file.

## Static And Dynamic Export

Static assets export directly as GLB. Assets with movable joints or material emission animation expose two choices: static and dynamic.

Static export keeps the canonical rest pose and omits animation channels.

Dynamic export uses the same canonical asset JSON and adds one asset-level glTF animation clip named `{asset.name} Motion`. Joint animation tracks are generated from manifest `controls` or fallback per-joint controls and target exported joint groups with standard TRS animation tracks. Keeping every exported joint and material animation in one clip is intentional: common glTF viewers often autoplay only the first clip.

The exported joint timeline uses the same shared animation speed helper as in-app preview. Each control keeps its own cycle period inside the single clip; shorter cycles are repeated instead of being stretched to wait for the longest control. Clip duration is chosen as a bounded common duration over quantized control/material periods so common viewers still see one coherent looping clip.

Non-wrapped controls allocate keyframe time by travel distance so oscillating controls move at the same speed in both directions. Rotational segments are subdivided by bound-joint angular travel before quaternion export, including large bounded revolute swings. Wrapped continuous controls use the same subdivision rule for the fastest bound joint scale. This avoids aliasing grouped mechanisms where a secondary joint spins multiple full turns per control cycle, such as a tail rotor bound at a higher scale than the main rotor.

Dynamic export also preserves `connectorTube` endpoint motion with morph-target weight tracks on the connector meshes, so cables and chains follow animated endpoint parts.

## Material Animation Export

Material emission animation is exported as glTF material animation, not as scene lights or app metadata.

`GLTFExporter` handles ordinary node TRS tracks but not `KHR_animation_pointer`, so `exportGlb.ts` post-processes the binary GLB JSON/BIN chunks for material emission animation. The post-process:

- appends animation sampler accessors and buffer views
- declares `KHR_animation_pointer`
- declares `KHR_materials_emissive_strength`
- writes material `emissiveFactor`
- writes `extensions.KHR_materials_emissive_strength.emissiveStrength`
- appends pointer-targeted animation channels for `/materials/{index}/emissiveFactor` into the asset-level clip
- appends pointer-targeted animation channels for `/materials/{index}/extensions/KHR_materials_emissive_strength/emissiveStrength` into the asset-level clip

Static export intentionally omits these animation channels.

## Export Cleanup

The clone pass strips non-exportable content before calling `GLTFExporter`:

- helper object types
- cameras
- lights
- lines
- points
- sprites
- objects marked `userData.exportable === false`
- all `userData`

Manifest3D ids and bounds are runtime/debug metadata. They should not leak into GLB `extras` unless a future interchange contract explicitly needs them.

## Material Conversion

Renderer materials are WebGPU node materials, while glTF export needs ordinary glTF-compatible PBR materials.

Export explicitly detects node materials and converts them to regular `THREE.MeshStandardMaterial`. `MeshStandardNodeMaterial` can also expose `isMeshStandardMaterial`, so conversion must reject node materials before cloning. Otherwise `GLTFExporter` writes material slots but falls back to default PBR values instead of authored color, metalness, roughness, and emission.

Manifest material side is preserved through export conversion. glTF represents the important interchange case with `doubleSided`; ordinary `front` materials omit that flag. Runtime rendering still obeys all three authored side modes: `front`, `back`, and `double`.

## Headless Artifacts

The headless stress harness reuses the same export path after a run reaches a fresh ready candidate. It writes static GLB artifacts for ready assets and dynamic GLB artifacts for assets that can export manifest animation.

The harness also exports per-attempt GLBs for schema-parseable candidates when possible so repair turns can be compared visually. This is a test artifact workflow only; app export remains Create-workspace driven.

## Tests

Export tests parse the generated binary GLB JSON chunk rather than only checking that bytes exist. They should continue asserting:

- mesh primitives reference material indices
- exported PBR and emission factors match the Manifest3D material contract
- static export omits animation channels
- dynamic export combines joint and material animation channels into one asset-level clip
- dynamic joint export contains real TRS animation tracks with symmetric non-wrapped control timing
- large revolute swing tracks are subdivided enough to avoid quaternion shortest-path stalls
- dynamic wrapped grouped controls preserve visible motion for high-scale linked continuous joints
- dynamic connectorTube export contains morph-target weight tracks
- dynamic material emission export contains pointer-targeted animation channels and real keyframe accessors

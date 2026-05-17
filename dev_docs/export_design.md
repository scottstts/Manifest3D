# Phase 6 Export Design Notes

GLB export is a Create-workspace action. The top-chrome button remains visible globally, but it is enabled only when the active workspace is `create` and the selected instance is the Create viewport instance (`instanceId === "create"`). Compose selections intentionally do not export yet because Compose instances carry arrangement transforms and multi-asset context that need a separate export contract.

Export starts from the selected Manifest3D asset JSON, not from the live React Three scene. `exportGlb.ts` rebuilds the asset into an isolated Three group, clones that group for export, and then disposes the intermediate build. This keeps selection state, transform controls, viewport helpers, lighting, the ground plane, and other renderer-only objects out of the exported file.

The clone pass strips non-exportable content before calling `GLTFExporter`: helper object types, cameras, lights, lines, points, sprites, objects marked `userData.exportable === false`, and all `userData`. Manifest3D ids and bounds remain runtime/debug metadata only; they should not leak into GLB `extras` unless a future interchange contract explicitly needs them.

Renderer materials are WebGPU node materials, but glTF export needs ordinary glTF-compatible PBR materials. `MeshStandardNodeMaterial` can also expose `isMeshStandardMaterial`, so export must explicitly detect node materials and convert them to regular `THREE.MeshStandardMaterial`. Otherwise GLTFExporter writes material slots but falls back to default PBR values instead of authored color, metalness, and roughness.

Export tests parse the generated binary GLB JSON chunk rather than only checking that bytes exist. They should continue asserting that mesh primitives reference material indices and that exported PBR factors match the Manifest3D material contract.

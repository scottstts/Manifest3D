# Renderer Notes

## Phase 2 Surface

Phase 2 introduced the Manifest3D-to-Three renderer path:

- Contract V2 Manifest documents are typed in `src/engine/schema/manifestTypes.ts` and parsed with Zod in `src/engine/schema/manifestSchema.ts`.
- Geometry construction lives in `src/engine/geometry/primitiveBuilders.ts`.
- `src/engine/geometry/assetBuilder.ts` converts a `ManifestAsset` into a Three.js `Group`, assembles parts through the joint graph, attaches `userData.manifest3d` metadata for picking, caches asset/part/visual bounds, and disposes generated geometry/materials on unmount.
- Runtime scene and selection state are plain stores in `src/engine/scene/`, then bridged into React from `src/app/appState.ts`.

The app currently starts with an empty Manifest3D scene. `src/engine/examples/rendererMockAssets.ts` is a development fixture for temporary visual inspection only; it should stay unplugged from app startup by default.

Renderer material side is asset-authored. Manifest material `side: "front" | "back" | "double"` maps directly to the Three material side on `MeshStandardNodeMaterial`, with missing legacy values treated as `front`. Do not paper over disappearing thin/open geometry by forcing all renderer materials to `DoubleSide`; validation and authored `expect_material_side` checks are responsible for making that choice explicit.

Viewport world lighting is explicit in `src/renderer/viewportWorld.ts`. Light mode is the existing bright background/fog/ground/light setup; dark mode only changes renderer-owned world colors and light intensities. It must not mutate asset materials or app chrome, though assets will naturally render under the selected world lights.

## Selection And Camera

Picking selects the top-level asset and stores the selected asset/part IDs. Repeatedly selecting the same asset increments a selection revision so the renderer treats it as a new focus request.

Selection focus changes the OrbitControls target to the selected asset bounds center. The snap is event-based: it animates only while closing the target-center gap, then stops so later pan/orbit input is not pulled back.

The right chat panel occludes part of the canvas, so selection centering uses an effective viewport. `src/renderer/effectiveViewport.ts` measures the visible right boundary from the side panel's left edge and applies `PerspectiveCamera.setViewOffset()` with a positive `offsetX` equal to half the right occlusion width. Keep this sign convention; using a negative offset centers against the full window visually.

Shift-drag clears selection before OrbitControls handles the gesture, so panning is not blocked by selected-asset focus state.

## Frame Loop

The main WebGPU canvas and separate gizmo overlay use `frameloop="demand"`. Idle scenes should not render continuously.

Any future animated renderer behavior must explicitly call Fiber `invalidate()` while motion is active. Current invalidation points are controls changes, selection emphasis, selection snap frames, effective viewport projection updates, viewport world mode changes, and gizmo camera quaternion changes.

## UI Coupling

The export control lives inside the top chrome on the right. It remains visible at all times and is enabled only when the active Create workspace has a viewed asset loaded. Static assets export directly as GLB; assets with movable joints expose static and dynamic GLB choices.

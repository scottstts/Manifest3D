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

## Viewport render modes

The viewport has two render modes: the default WebGPU/TSL renderer and an optional WebGL2 path tracer. The default WebGPU renderer remains the authoritative interactive viewport. In path tracer mode, the WebGPU canvas stays mounted but is visually hidden so existing camera controls, selection, and transform flows continue to run unchanged. A separate `PathTracingCanvas` overlays the viewport with `pointer-events: none` and mirrors the current camera, world settings, and renderable assets.

The path tracer pipeline is isolated in `src/renderer/pathtracer/`. It rebuilds a path-tracing-specific Three scene from the same scene snapshot, applies the same world lighting/ground settings, converts Manifest3D node materials to plain `MeshStandardMaterial`, and then uses `three-gpu-pathtracer` for progressive emissive-lighting render samples. Render tuning such as bounces, bloom, emission gain, texture size, tile layout, and max sample count is intentionally code-only in `pathTracingConfig.ts`.

The live path tracer viewport uses a 1x1 tile layout so early convergence fills the whole viewport instead of showing only one tile/quadrant. The path tracer sample counter is viewport UI, not a user tuning knob, and displays current accumulated samples against the code-level max sample cap.

Animation preview playback belongs only to the default WebGPU viewport. Path tracer mode hides the animation panel and clears active preview playback when entered so the path-traced view remains a still progressive render rather than an animation preview surface.

Path tracer mode also has renderer-mode-specific navigation behavior: OrbitControls damping is disabled and selected-asset target centering snaps immediately. The hidden WebGPU canvas still owns picking and camera state, but path tracer mode should not leave residual inertia after pan/orbit input because any lingering camera movement delays progressive sample accumulation. Default mode keeps the existing damped camera behavior.

The path tracer mirrors the hidden WebGPU camera snapshot and applies the same `PerspectiveCamera.setViewOffset()` projection from `src/renderer/effectiveViewport.ts` as the default WebGPU viewport. Keep this projection-offset path shared between the two render modes; a prior path-tracer-specific look-target shift did not visually match default centering because it depended on the controls target rather than applying the same screen-space projection shift. Because the hidden WebGPU canvas runs on demand in path tracer mode, camera snapshots must be pushed directly from OrbitControls changes and selection-target snaps instead of relying only on passive frame polling.

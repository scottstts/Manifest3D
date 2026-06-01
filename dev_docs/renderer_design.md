# Renderer Design

This document describes the implemented Manifest3D renderer: the default WebGPU/TSL viewport, selection and camera behavior, demand rendering, animation preview, and the isolated WebGL2 path tracer.

## Default Viewport

The default viewport is WebGPU with Three.js TSL. It is the authoritative interactive renderer.

Contract V2 Manifest documents are typed in `src/engine/schema/manifestTypes.ts` and parsed with Zod in `src/engine/schema/manifestSchema.ts`. Geometry construction lives in `src/engine/geometry/primitiveBuilders.ts`. `src/engine/geometry/assetBuilder.ts` converts a `ManifestAsset` into a Three.js `Group`, assembles parts through the joint graph, attaches `userData.manifest3d` metadata for picking, caches asset/part/visual bounds, and disposes generated geometry/materials on unmount.

Runtime scene and selection state are plain stores in `src/engine/scene/` and are bridged into React from `src/app/appState.ts`.

The ground is a large plain diffuse white-lavender plane with subtle reflectance and no visible grid. Viewport world lighting is explicit in `src/renderer/viewportWorld.ts`. Light mode is the bright background/ground/light setup; dark mode changes only renderer-owned world colors and light intensities. It does not mutate asset materials or app chrome.

The default WebGPU viewport does not attach scene fog, so large assets remain readable when the camera is zoomed out.

## Pixel Ratio And Sizing

The viewport DPR budget uses the project cap:

```typescript
const maxPixels = 4_000_000;

const dpr = Math.min(
  window.devicePixelRatio,
  1.75,
  Math.sqrt(maxPixels / (innerWidth * innerHeight))
);

renderer.setPixelRatio(Math.max(1, dpr));
```

The WebGPU renderer must be sized before `WebGPURenderer.init()` in the R3F `gl` factory. Prefer canvas layout size, then parent layout size, then window size before falling back to canvas backing size, so WebGPU post-processing attachments do not start from the browser default `300x150` buffer.

`SceneEffectsPipeline` is size/DPR-sensitive. Keep R3F size and viewport DPR in its memo dependencies so TSL render pipelines, MRT, bloom, and outline attachments rebuild after viewport resize, browser zoom, side-panel layout changes, or monitor DPR changes.

## Materials

Renderer material side is asset-authored. Manifest material `side: "front" | "back" | "double"` maps directly to the Three material side on `MeshStandardNodeMaterial`, with missing legacy values treated as `front`.

Do not force all materials to `DoubleSide` to hide disappearing thin or open geometry. Validation and authored `expect_material_side` checks make that choice explicit.

Selection emphasis uses the Three WebGPU/TSL `OutlineNode` pipeline rather than tinting materials or adding per-mesh back-side expansion. The outline renders selected assets as a screen-space mask with a camera-perspective silhouette. The edge mask is boosted with `edgeGlow` and used to replace pixels with the outline color so it remains visible over bright backgrounds.

## Selection And Camera

Picking selects the top-level asset and stores selected asset/part ids. Re-selecting the same asset increments a selection revision so the renderer treats it as a new focus request.

Selection focus changes the OrbitControls target to the selected asset bounds center. The snap is event-based: it animates only while closing the target-center gap, then stops so later pan/orbit input is not pulled back.

Selection camera centering reacts to the selected Three object becoming available, not only to `selectionRevision`. History opens and fresh Create results can set selection before the asset group registers.

The right agent panel occludes part of the canvas, so selection centering uses an effective viewport. `src/renderer/effectiveViewport.ts` measures the visible right boundary from the side panel's left edge and applies `PerspectiveCamera.setViewOffset()` with a positive `offsetX` equal to half the right occlusion width. Keep this sign convention.

Shift-drag clears selection before OrbitControls handles the gesture, so panning is not blocked by selected-asset focus state.

Default viewport camera clipping is controlled by `defaultViewportCameraConfig` in `src/renderer/viewportCamera.ts`. The far plane is set beyond the OrbitControls max zoom-out distance and is the shared place to tune default/path-tracer camera clipping.

## Shadows And Lighting

Default WebGPU contact shadows are controlled by `src/renderer/viewportShadows.ts`.

`defaultViewportShadowConfig` sets minimum quality and coverage. `computeDefaultViewportShadowState()` dynamically fits the key directional light's shadow camera to the asset bounds plus the asset's projected ground shadow. This keeps tall assets inside the shadow camera without solving shadow truncation by resizing the ground plane.

Keep the map size high enough to avoid visibly soft shadows when dynamic bounds expand.

## Gizmo And Controls

The XYZ gizmo uses Drei `GizmoHelper` and `GizmoViewport` in a small transparent WebGPU overlay canvas. The overlay runs at normal device density so sprite labels stay crisp while the main viewport keeps its DPR budget.

The gizmo is fixed in the top-right of the open viewport. When the side panel collapses, it slides to the top-right of the overall viewport.

The viewport world-mode control is an icon-only two-button group fixed at the top-left of the effective viewport. It slides with the left asset panel and changes renderer world lighting only.

The render-mode control sits near the viewport world-mode control. Path tracer-only controls appear only when path tracer mode is active.

## Demand-Driven Rendering

The main WebGPU canvas and separate gizmo overlay use `frameloop="demand"`. Idle scenes should not render continuously.

Animated renderer behavior must explicitly call Fiber `invalidate()` while motion is active. Current invalidation points include controls changes, selection emphasis, selection snap frames, effective viewport projection updates, viewport world mode changes, animation preview state, material emission preview state, and gizmo camera quaternion changes.

Joint preview and material emission preview are runtime state. The renderer applies joint values to already-built joint groups through `applyBuiltManifestJointPoses` and material emission values through `applyBuiltManifestMaterialAnimations`.

Animation preview playback belongs only to the default WebGPU viewport.

## Render Modes

The viewport has two render modes:

- default WebGPU/TSL
- optional WebGL2 path tracer

In path tracer mode, the WebGPU canvas stays mounted but is visually hidden so existing camera controls, selection, picking, and transform flows continue to run. `PathTracingCanvas` overlays the viewport with `pointer-events: none` and mirrors the current camera, world settings, renderable assets, pose preview, and material preview.

Path tracer mode hides the animation panel and clears active preview playback when entered. The path-traced view is a still progressive render, not an animation preview surface.

## Path Tracer Pipeline

The path tracer pipeline is isolated in `src/renderer/pathtracer/`. It rebuilds a path-tracing-specific Three scene from the same scene snapshot, applies the same world lighting/ground settings, converts Manifest3D node materials to plain `MeshStandardMaterial`, and uses `three-gpu-pathtracer` for progressive emissive-lighting samples.

Render tuning such as bounces, bloom, emission gain, texture size, tile layout, emissive mesh sampling, interaction sample cap, and max sample count lives in `pathTracingConfig.ts`.

The live path tracer viewport uses a `1x1` tile layout so early convergence fills the whole viewport. Accumulation stops once the selected max sample count is reached and restarts only when path tracer inputs change.

During progressive accumulation, the raw path-tracer target is presented directly to the canvas. Do not run asset bloom, EffectComposer output, or denoising per sample. The post stack is a final-frame operation: after the selected max sample count is reached and camera interaction is inactive, run final denoise if enabled, then asset bloom/composer once, and mark that final output clean until an input change dirties it again.

Path-tracer scene upload uses `WebGLPathTracer.setSceneAsync()` with a `three-mesh-bvh` BVH worker. This moves BVH construction off the main thread, though path-tracer scene conversion and static geometry merge still perform synchronous setup before the worker task starts. Avoid starting concurrent scene uploads; queue later scene/camera changes behind the current upload.

The path-tracing frame loop is cooperative. Each scheduled frame should do only one expensive class of work: upload, one raw sample, or one final post pass. If the browser reports pending input, defer the next path-tracing unit briefly rather than competing with UI interaction.

The sample counter is viewport UI, not a render-tuning knob. It displays accumulated samples against the selected max-sample target. The counter is clickable and persists one of the supported targets: `128`, `256`, or `512`. Raising the target continues the existing accumulation; lowering it changes the completion threshold without resetting the existing texture.

## Path Tracer Camera Mirroring

Path tracer mode disables OrbitControls damping and snaps selected-asset centering immediately. This avoids lingering camera movement that would delay progressive accumulation.

The path tracer mirrors the hidden WebGPU camera snapshot and applies the same `PerspectiveCamera.setViewOffset()` projection helper from `src/renderer/effectiveViewport.ts`. Do not use path-tracer-specific look-target shifts; they do not match the default viewport when the controls target differs from the visual asset center.

Because the hidden WebGPU canvas is demand-rendered in path tracer mode, camera snapshots are pushed directly from OrbitControls changes and selection-target snaps. They do not rely only on passive frame polling.

Fallback camera snapshots use the same default viewport camera constants and `lookAt` the default OrbitControls target before exporting the quaternion.

`three-gpu-pathtracer` reads object `matrixWorld` values when baking geometry. After rebuilding the path-tracing scene, call `scene.updateMatrixWorld(true)` before upload, and keep the upload path doing the same defensively.

Post-processing viewport reset uses `renderer.getSize()` CSS pixels, not `getDrawingBufferSize()` physical pixels. `WebGLRenderer.setViewport()` already applies DPR for the default framebuffer.

## Path Tracer Lighting And Bloom

`three-gpu-pathtracer` treats supported direct lights as physically shadowing. To match the default viewport's non-shadowing fill behavior, the path-traced direct-light set keeps only the key directional light and approximates fill with a low-intensity gradient environment.

Path tracer bloom is asset-scoped. `pathTracingAssetBloomPipeline.ts` builds an asset visibility mask, blooms only masked path-traced asset color, then composites that bloom over the full path-traced base before output. Viewport world, background, and ground surfaces do not feed bloom.

Path tracer bloom is tuned separately from the default WebGPU bloom because path-traced emissive surfaces can accumulate much hotter HDR values before post-processing.

## Emissive Mesh Sampling

High-risk emissive mesh scenes use an app-local next-event sampling extension in `pathTracingEmissiveMeshSampling.ts`.

The extension scans the actual path-tracing scene for opaque emissive mesh triangles, uploads a power-weighted triangle CDF, and patches the `three-gpu-pathtracer` material so rough dielectric receiver bounces can shadow-test one sampled point on the real emissive surface.

It does not add proxy lights or alter emissive strength, bloom, or tone mapping. It is risk-gated for compact bright emissive geometry plus dark rough diffuse receiver area.

When patching the path-tracer material shader at startup, mark the material dirty through Three's base `Material.needsUpdate` setter. Avoid `MaterialBase.needsUpdate`, which can trigger noisy early `compileAsync()` paths before `currentProgram` exists.

## Interaction Sampling

Direct OrbitControls input in path tracer mode uses an interactive-preview sample cap. While pan/orbit/wheel input is active, `PathTracingCanvas` uses `pathTracingConfig.interaction.activeSampleLimit`. After the navigation settle delay, full progressive accumulation resumes from the current camera.

This keeps navigation responsive while avoiding expensive full-sample accumulation during active viewport movement.

## Final-Frame Denoising

The WebGL2 path tracer has an isolated final-frame denoise pass in `pathTracingDenoisePipeline.ts`. It is not part of the default WebGPU renderer.

Denoising is controlled by a path-tracer-only Denoiser toggle. The preference defaults off and persists in localStorage. When enabled, denoising runs only after progressive accumulation reaches the selected max sample count. During progressive accumulation, the raw `WebGLPathTracer` target is displayed directly without post-processing.

The denoise pipeline is a non-ML GPU postprocess with no npm dependency. It rasterizes guide buffers from the path-tracing scene and camera: high-precision view normals, linearized depth, material transparency/roughness/emissive protection/object keys, and albedo/metalness.

The filter uses compressed-HDR firefly clamping, rough-opaque diffuse illumination reconstruction, bounded adaptive à-trous passes, and residual-aware final detail composition. Silhouettes, transparent edges, emissive surfaces, and guide-buffer edges blend back toward raw or firefly-cleaned path-traced color. Transparent interiors can receive limited smoothing.

Emissive-firefly recovery is separately gated by scene risk and raw-frame confidence. It only contributes on risky dark rough dielectric receiver pixels and keeps emissive, transparent, metallic/specular, silhouette, and guide-edge regions protected.

Reset denoise state whenever path tracer samples reset: camera changes, viewport/DPR changes, scene rebuilds, world-mode changes, pose/material preview changes, or path-tracer scene upload.

Shader helper names in denoise code should be denoise-prefixed to avoid collisions with Three.js shader chunks or generated code. If a denoise WebGL pass reports an error, the raw path-tracer texture remains the fallback.

## Runtime Warning Filter

The runtime installs a narrow console warning filter for the exact harmless upstream `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` message. Keep the filter exact so real Three.js warnings and WebGL shader/program errors still surface.

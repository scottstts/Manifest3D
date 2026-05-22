# Manifest3D UI Notes

## Core Layout

- The WebGPU viewport is the app background. Do not wrap it in a visible viewport card, framed container, nested box, or grid surface.
- The top chrome and right agent panel are direct overlays on the viewport.
- The desktop agent panel aligns to the top chrome edges: its right edge matches the top chrome right edge, and its bottom viewport inset matches the top chrome top inset. Its width is responsive within a min/max range, not fixed.
- Phase 1 keeps the viewport empty: no mock assets, no mock toolbars, no mock messages, no status chips, and no decorative scene content.
- The right panel is a frosted side panel with an empty thread and the prompt composer only. It can collapse, and future content should not introduce card-in-card nesting.

## Viewport

- The ground is a large, plain, diffuse white-lavender plane with subtle reflectance. No visible grid.
- The renderer must stay WebGPU-only. Do not add a WebGL fallback.
- The viewport DPR budget must keep using the project cap of `1_650_000` pixels and max DPR `1.5`.
- The XYZ gizmo uses Drei's built-in `GizmoHelper` and `GizmoViewport` in a small WebGPU overlay canvas so its sprite labels can render at normal device density. Do not reintroduce custom gizmo geometry, CSS-only gizmos, or scaled-up Drei sprite heads.
- The gizmo is fixed in the top-right of the open viewport. When the side panel collapses, it slides to the top-right of the overall viewport.
- The viewport world mode control is an icon-only two-button group fixed at the top-left of the effective viewport. It slides with the left asset panel and changes only renderer world lighting, not the UI theme.

## Chrome And Brand

- The logo uses `public/logo.png` plus a glassy SVG wordmark adapted from `refs/logo_demo.html`.
- Keep the wordmark responsive inside the top chrome; do not let it overflow mobile widths.
- The top chrome should remain quiet and sparse. Do not add right-side tags, viewport labels, or extra nav controls unless a later phase explicitly needs real controls.

## Prompt Panel

- Keep a clear vertical gap between the placeholder row and the attach/send button row.
- Attach/send controls are icon buttons. Avoid replacing them with text pills, and keep the send glyph optically centered inside its circle.

## Verification

- Do not run browser visual verification unless explicitly requested.
- If screenshots are requested later, place them under `dev_docs/ui_verification/`, not the project root.

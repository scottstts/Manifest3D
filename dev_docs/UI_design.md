# UI Design

This document describes the implemented Manifest3D application UI: workspace layout, panels, prompts, provider controls, validation timelines, and Compose editing behavior.

## Core Layout

The WebGPU viewport is the app background. It is not wrapped in a visible viewport card, framed container, nested box, or grid surface.

The top chrome, left asset history panel, right agent panel, viewport controls, and gizmo are overlays on the viewport. The top chrome stays quiet and sparse; extra tags, viewport labels, and decorative controls should not be added unless they represent real product controls.

The desktop right agent panel aligns to the top chrome edges. Its right edge matches the top chrome right edge, its bottom viewport inset matches the top chrome top inset, and its width is responsive within min/max bounds.

The left asset history panel overlays the viewport when expanded. It does not shift the effective viewport center.

The app starts with an empty Manifest3D scene. Development fixtures should not be wired into startup by default.

## Brand And Top Chrome

The logo uses `public/logo.png` plus a responsive glassy SVG wordmark adapted from `refs/logo_demo.html`. The wordmark must fit inside top chrome at mobile-width constraints.

The API Key button shows provider readiness through a status dot. Localhost and loopback load keys through the dev-server `.env` endpoint and keep the modal click-locked. Deployed origins use the in-memory Providers panel. API keys must not enter the built client bundle.

The export control lives in top chrome on the right. It remains visible and is enabled only when the active Create workspace has a viewed asset loaded. Static assets export directly; assets with movable joints or material emission animation expose static and dynamic GLB choices.

## Workspaces

Create is a single-asset workspace. It can show one generated or loaded asset at a time.

Compose is a multi-asset workspace for arranging saved assets. Prompting and editing are disabled in Compose.

Create viewport asset state is distinct from the transient renderer outline selection. Clearing the outline does not clear left-panel active asset state, edit-mode right panel state, version navigation, or export eligibility while the Create viewport still shows that asset.

Version navigation applies to the viewed asset context. In Create, this is the single Create viewport instance. In Compose, it is the selected compose instance.

Newly generated or loaded Create assets are placed so their full bounds sit above the table plane.

## Prompt Panel

The right panel mode pill says `creating` when no Create asset is loaded or a create run is the active view. It says `editing` whenever the Create viewport is showing an asset, even if the renderer outline selection is cleared.

Starting a new Create asset clears the active runtime transcript, candidate timeline, current Create viewport asset, and selection. It does not delete saved history or stop background runs.

Submitting a create prompt clears the previous Create viewport asset before the run. Submitting an edit prompt uses the current Create viewport asset as context.

The prompt composer keeps a clear vertical gap between the placeholder row and the attach/send row. Attach and send controls are icon buttons; the send glyph is optically centered inside its circular button.

Image attachments can be selected from disk or pasted into the prompt textarea. Attached images show removable thumbnails before submission and thumbnail context in the runtime transcript. Persisted prompt-image thumbnails open an in-app image preview modal; closing uses the `X`, Escape, or an outside click.

The send/stop control follows the currently selected run. It becomes a running stop button only when the active right-panel view is a running create/edit task. Saved asset views keep the normal send button even when other runs continue in the background.

## Running Tasks And History

Multiple create/edit runs may continue in the background. Running create jobs appear as top `Creating` rows in the asset history panel, using the submitted prompt as the temporary title. Running edit jobs stay attached to their source asset row.

Opening a running row restores that task's prompt message and progress timeline until it finishes. App jobs run against isolated scene stores so browsing saved assets does not mutate in-flight prompt context.

Saved versions persist agent events alongside validation attempts. History opens reconstruct the same continuous progress timeline from persisted events and attempts when available; older versions without events reconstruct from attempts only.

Asset history items represent one logical asset with multiple versions. Opening an asset defaults to its last selected version, falling back to the latest version. Asset ordering is by original creation time descending.

## Validation Timeline

Timeline rows should not expose raw validator strings, raw paths, debug key/value pairs, or provider internals when a normalized message is available.

Failure and warning rows should always show a user-facing detail. Known validation signal codes map to concise messages about what the candidate needs to fix, not implementation details about how the validator measured it.

Running steps show a spinner; completed rows show pass/fail/warning state. Routine agent event details such as prompt mode or response id stay hidden. Failed agent events may show one concise detail line.

Agent progress timelines are sectioned by attempt. The first section is `Initial attempt`; later sections are `Repair N`. The section header appears when the attempt begins. The closing separator appears only when the attempt reaches a terminal result.

Completed `validating_candidate` events are normalized into the candidate result row instead of rendering both a validation step and a candidate result. Failed attempts show only the concise failure summary on the candidate result row; successful attempts keep the full validation step trace.

## Compose Editing

Compose toolbar actions are duplicate, delete, move, rotate, and scale. They apply only to the selected compose instance.

Compose undo/redo is an in-memory workspace buffer. It tracks duplicate, delete, and transform changes, and it is cleared when the compose scene is materially replaced by history or version actions.

Keyboard shortcuts are Compose-only:

- undo: platform command/control + Z
- duplicate: command/control + D
- delete: Backspace/Delete
- move: G
- rotate: R
- scale: S

Transform controls keep the full selected geometry above the table plane. Move clamps position so the object cannot cross below the table. Scale and rotate reject transforms that would place geometry below the table rather than auto-lifting the object.

Rotation blocking is gesture-stateful. Once a rotation drag hits the table-plane constraint, that drag remains blocked until release to avoid snapping across a disallowed angle range.

Gizmo hover styling must remain visible against the pale viewport.

## Desktop Gate

App startup is desktop-gated. Mobile and tablet browsers receive a lightweight desktop-only message inside a top frame with the same logo treatment and do not import the React/WebGPU app bundle.

## Verification

Do not run browser visual verification unless explicitly requested.

If screenshots are requested, place them under `dev_docs/ui_verification/`, not the project root.

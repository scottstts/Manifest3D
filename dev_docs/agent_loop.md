# Phase 5 Design Notes

Phase 5 turns the local Manifest3D harness into a usable create/edit surface with saved asset history and a compose workspace. These notes capture the design choices that are not obvious from individual files.

## Agent Context

- The harness remains stateless from the LLM transcript perspective. Each create/edit run compiles a fresh prompt from the current scene, current selected asset when editing, optional image attachments, and compact attempt context for the selected saved version.
- Full LLM transcripts are intentionally not persisted. The visible chat transcript in the right panel is a runtime UI affordance only.
- Candidate attempts are different from chat transcripts. Attempts are saved with the validated asset version that produced or repaired them, so future edits can include compact validation history without replaying the whole conversation.
- The agent loop commits only a fresh valid candidate. Candidate freshness is still guarded by the candidate history fingerprint before the asset is saved or rendered.
- The OpenAI client owns provider-specific request details. UI and scene code should continue to talk to the provider through the agent loop/client interfaces, not by reaching into Responses API payloads.

## Persistence

- IndexedDB stores the asset library: asset records, ordered version records, and validation attempts per version.
- Only validated assets are persisted. Invalid attempts are persisted only as context under a saved valid version, never as standalone library assets.
- Asset list ordering is by original creation time descending. Later-created assets appear above older assets; editing an old asset should not reorder it by last update.
- Each asset history item represents one logical asset with multiple versions. Opening an asset defaults to its last selected version, falling back to the latest version.
- The scene store is runtime-only. Persisted asset data and active viewport placement are deliberately separate.

## Workspaces

- Create is a single-asset workspace. It can show one generated or loaded asset at a time.
- Compose is a multi-asset workspace for arranging saved assets only. Prompting and editing are disabled there.
- The left asset history panel overlays the viewport when expanded. It must not shift the effective viewport center.
- The right agent panel affects Create viewport centering because it occludes the usable viewport area.
- Version navigation applies to the selected asset instance. In Create this is the single create instance; in Compose it is the selected compose instance.

## Create And Edit UX

- The right panel mode pill says `creating` when no Create asset is selected and `editing` when the Create asset is selected.
- Starting a new Create asset clears the runtime transcript, candidate timeline, current Create viewport asset, and selection. It does not delete saved history.
- Submitting a create prompt clears the previous Create viewport asset before the run. Submitting an edit prompt keeps the current selected asset as edit context.
- User prompt messages and agent timeline messages are interleaved in the right panel for the current runtime session only.
- Image attachments can be selected from disk or pasted into the prompt textarea. Attached images show removable thumbnails before submission and thumbnail context in the runtime transcript.
- While an agent run is active, the send button becomes a running stop button: spinner ring plus a square center. Clicking it aborts the run through `AbortSignal`.

## Validation Trace

- Timeline rows should not expose raw validator strings, raw paths, debug key/value pairs, or provider errors when a normalized message can be shown.
- Failure and warning rows should always show a user-facing detail. If a signal is missing or unknown, fall back to a stage-specific explanation.
- Known validation signal codes should map to short messages about what the candidate needs to fix, not implementation details about how the validator measured it.
- Running steps show a spinner; completed rows show pass/fail/warning state. Debug details such as prompt mode are not part of the user-facing row copy.

## Compose Editing

- Compose toolbar actions are duplicate, delete, move, rotate, and scale. They apply only to the selected compose instance.
- Compose undo/redo is an in-memory workspace buffer. It tracks duplicate, delete, and transform changes, and is cleared when the compose scene is materially replaced by history/version actions.
- Keyboard shortcuts are Compose-only: undo with platform command/control + Z, duplicate with command/control + D, delete with Backspace/Delete, move with G, rotate with R, scale with S.
- Transform controls must keep the full selected geometry above the table plane.
- Move clamps position so the object cannot cross below the table plane.
- Scale and rotate reject transforms that would place any geometry below the table plane. They should not auto-lift the object.
- Rotation blocking is gesture-stateful: once a rotation drag hits the table-plane constraint, that drag remains blocked until release to avoid snapping across a disallowed angle range.
- Gizmo hover styling should stay visible against the pale viewport; avoid hover states that wash the gizmo into the background.

## Viewport Framing

- Newly generated or loaded Create assets are placed so their full bounds sit above the table plane.
- Camera fitting should handle very small generated assets without forcing the user into a poor zoom limit. Keep a reasonable limit, but derive it from the selected asset scale rather than a fixed maximum distance policy.

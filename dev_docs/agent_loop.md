# Phase 5 Design Notes

Phase 5 turns the local Manifest3D harness into a usable create/edit surface with saved asset history and a compose workspace. These notes capture the design choices that are not obvious from individual files.

## Agent Context

- The harness remains stateless from the LLM transcript perspective. Each create/edit run compiles a fresh prompt from the current scene, the current Create viewport asset when editing, optional image attachments, compact attempt context for the selected saved version, and saved user-input history for the selected version lineage.
- Full LLM transcripts are intentionally not persisted. Direct user input per saved version is persisted instead: submitted text plus attached image data/metadata. Later edit prompts prepend that accumulated user-input history, including the pending turn, before the existing prompt assembly.
- Candidate attempts are different from chat transcripts. Attempts are saved with the validated asset version that produced or repaired them, so future edits can include compact validation history without replaying the whole conversation.
- The agent loop commits only a fresh valid candidate. Candidate freshness is still guarded by the candidate history fingerprint before the asset is saved or rendered.
- Provider clients own provider-specific request details. UI and scene code should continue to talk to providers through the agent loop/client interfaces, not by reaching into OpenAI Responses or Gemini GenerateContent payloads.
- OpenAI remains the starting provider default. The last provider selected in the Providers panel is cached as the next default; API keys are not persisted outside local `.env`.
- Localhost/loopback runs load provider keys only through the dev-server `.env` endpoint. The top-bar status dot is green when at least one local provider key is present. Non-localhost runs use in-memory per-provider keys from the Providers panel, and the status dot is green only when the currently selected provider has a session key.

## Persistence

- IndexedDB stores the asset library: asset records, ordered version records, validation attempts per version, and optional per-version user input.
- Persistence writes are scoped to the touched logical asset, or to the deleted asset id. Do not clear and rewrite the full asset/version/attempt stores for normal saves because multiple tabs can create different assets concurrently.
- Only validated assets are persisted. Invalid attempts are persisted only as context under a saved valid version, never as standalone library assets.
- Legacy version rows without `userInput` stay valid. They should keep the old attempt-only UI and prompt behavior until a new validated edit creates a version with submitted user input.
- Asset list ordering is by original creation time descending. Later-created assets appear above older assets; editing an old asset should not reorder it by last update.
- Each asset history item represents one logical asset with multiple versions. Opening an asset defaults to its last selected version, falling back to the latest version.
- The scene store is runtime-only. Persisted asset data and active viewport placement are deliberately separate.

## Workspaces

- Create is a single-asset workspace. It can show one generated or loaded asset at a time.
- Compose is a multi-asset workspace for arranging saved assets only. Prompting and editing are disabled there.
- The left asset history panel overlays the viewport when expanded. It must not shift the effective viewport center.
- The right agent panel affects Create viewport centering because it occludes the usable viewport area.
- Version navigation applies to the viewed asset context. In Create this is the single Create viewport instance even if the object outline is cleared; in Compose it remains the selected compose instance.

## Create And Edit UX

- The right panel mode pill says `creating` when no Create asset is loaded or a create run is the active view, and `editing` whenever the Create viewport is showing an asset, even if the asset object itself is not selected/outlined.
- Starting a new Create asset clears the active runtime transcript, candidate timeline, current Create viewport asset, and selection. It does not delete saved history and does not stop background agent runs.
- Submitting a create prompt clears the previous Create viewport asset before the run. Submitting an edit prompt uses the current Create viewport asset as edit context, not the transient renderer object-selection outline.
- Multiple create/edit runs may continue in the background. Running create jobs appear as top `Creating` rows in the asset history panel; running edit jobs stay attached to their source asset row. Opening one of those rows restores that run's prompt message and progress timeline until it finishes.
- User prompt messages and agent timeline messages are interleaved in the right panel from saved version lineage when per-version user input exists. Running follow-up edits prepend the selected version transcript before the current turn, then the saved transcript is rebuilt from persistence after commit.
- Image attachments can be selected from disk or pasted into the prompt textarea. Attached images show removable thumbnails before submission and thumbnail context in the runtime transcript.
- Persisted prompt-image thumbnails in the agent panel open an in-app image preview modal; closing uses the `X`, Escape, or clicking outside the image.
- The send/stop control follows the currently selected run. It becomes a running stop button only when the active right-panel view is a running create/edit task; selected saved assets keep the normal send button even when other runs continue in the background.

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

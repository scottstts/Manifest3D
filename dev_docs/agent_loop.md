# Phase 5 Design Notes

Phase 5 turns the local Manifest3D harness into a usable create/edit surface with saved asset history and a compose workspace. These notes capture the design choices that are not obvious from individual files.

## Agent Context

- The harness remains stateless from the LLM transcript perspective. Each create/edit run compiles a fresh prompt from the current scene, the current Create viewport asset when editing, optional image attachments, compact attempt context for the selected saved version, and saved user-input history for the selected version lineage.
- Full LLM transcripts are intentionally not persisted. Direct user input per saved version is persisted instead: submitted text plus attached image data/metadata. Later edit prompts prepend that accumulated user-input history, including the pending turn, before the existing prompt assembly.
- Candidate attempts are different from chat transcripts. Attempts are saved with the validated asset version that produced or repaired them, so future edits can include compact validation history without replaying the whole conversation. Saved versions also keep the agent progress events for the run, so the same continuous progress timeline can be reconstructed from persistence instead of falling back to attempt-only history.
- The agent loop commits only a fresh valid candidate. Candidate freshness is still guarded by the candidate history fingerprint before the asset is saved or rendered.
- Provider clients own provider-specific request details. UI and scene code should continue to talk to providers through the agent loop/client interfaces, not by reaching into OpenAI Responses or Gemini GenerateContent payloads.
- OpenAI remains the starting provider default. The last provider selected in the Providers panel is cached as the next default; API keys are not persisted outside local `.env`.
- Localhost/loopback runs load provider keys only through the dev-server `.env` endpoint. The top-bar status dot is green when at least one local provider key is present. Non-localhost runs use in-memory per-provider keys from the Providers panel, and the status dot is green only when the currently selected provider has a session key.

## Persistence

- IndexedDB stores the asset library: asset records, ordered version records, validation attempts per version, and optional per-version user input.
- Persistence writes are scoped to the touched logical asset, or to the deleted asset id. Do not clear and rewrite the full asset/version/attempt stores for normal saves because multiple tabs can create different assets concurrently.
- Only validated assets are persisted. Invalid attempts are persisted only as context under a saved valid version, never as standalone library assets.
- Legacy version rows without `userInput` stay valid. They should not fabricate chat transcript turns; once a newer version has submitted user input, its timeline can still be reconstructed from the persisted attempts and any stored agent events.
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
- User prompt messages and agent timeline messages are interleaved in the right panel from saved version lineage when per-version user input exists. Running follow-up edits prepend the selected version transcript before the current turn. The current run's agent message is then updated in place through commit so the visible timeline remains continuous; later history opens reconstruct that same timeline from persisted agent events plus validation attempts.
- Image attachments can be selected from disk or pasted into the prompt textarea. Attached images show removable thumbnails before submission and thumbnail context in the runtime transcript.
- Persisted prompt-image thumbnails in the agent panel open an in-app image preview modal; closing uses the `X`, Escape, or clicking outside the image.
- The send/stop control follows the currently selected run. It becomes a running stop button only when the active right-panel view is a running create/edit task; selected saved assets keep the normal send button even when other runs continue in the background.

## Validation Trace

- Timeline rows should not expose raw validator strings, raw paths, debug key/value pairs, or provider errors when a normalized message can be shown. Routine agent event details such as prompt mode or response id stay hidden; failed agent events may show only their first concise detail line.
- Failure and warning rows should always show a user-facing detail. If a signal is missing or unknown, fall back to a stage-specific explanation.
- Known validation signal codes should map to short messages about what the candidate needs to fix, not implementation details about how the validator measured it.
- Running steps show a spinner; completed rows show pass/fail/warning state. Debug details such as prompt mode are not part of the user-facing row copy.
- Agent progress timelines are sectioned by attempt. The first section is labeled `Initial attempt`; later sections are labeled `Repair N`. The header separator appears as soon as that attempt begins, and the closing separator is appended only when the attempt reaches a terminal result.
- Completed `validating_candidate` events are normalized into the candidate result row instead of rendering both `Validate candidate` and `Candidate validation failed/validated`. Failed attempts show only the concise validation failure summary on the candidate result row; successful attempts keep the full validation step trace.

## Diagnostic Repair Loop

- Create and edit turns return a complete Manifest3D asset. Repair turns return a JSON Patch envelope. The harness applies the patch to the last failed candidate, validates the patched asset, and only commits a fresh valid candidate. If patch application fails, the next repair turn receives a patch-application error and the prior candidate remains the source of truth.
- Candidate history failure signatures are semantic cluster signatures, not raw signal hashes. Clusters normalize by stage, kind, code, unordered part pair or stable ref, and sampled-pose key while ignoring depth, volume, and visual-level noise. This catches plateau or oscillation cases where the same mechanism failure keeps changing exact measurements.
- Repair feedback also detects relation oscillation across recent attempts. If the same part pair alternates between overlap and gap/contact failures, the next repair prompt calls it out as one mounting/support relation problem instead of encouraging another small nudge.
- Buildable attempts store deterministic probe reports with asset and part bounds, joint-origin distances, connector endpoint measurements, and failed-pair relation metrics such as closest visual pair, distance, penetration depth, and overlap volume. Repair feedback includes a compact probe section as geometry sensor data. This is the Manifest3D analogue of Articraft probe measurements; it is not rendered-image feedback.
- `connectorTube` is the supported representation for flexible chains, cables, hoses, ropes, straps, tethers, wires, bridge hangers, and suspension cables whose endpoints belong to parts. Endpoint positions are local to referenced parts, and the builder regenerates the tube from current joint transforms for validation and preview.
- Connector tubes use subdivided overlap proxies. Only the endpoint-adjacent proxy chunks can ignore contact with the referenced endpoint parts; connector overlap with unrelated obstructions remains a validation failure.
- Dynamic GLB export preserves `connectorTube` endpoint motion with morph-target weight tracks on the connector meshes, alongside the regular joint animation tracks.
- Repair patches are applied to a cloned candidate and then checked against the Manifest3D asset schema before the patched candidate is accepted as the next attempt. Schema-invalid patches are reported as patch-application errors and the prior candidate remains the repair source. The repair patch response schema supports standalone numeric vector values for focused geometry edits and disallows unconstrained empty array patch values. Repeated identical patch-application errors are tracked inside the loop so the next repair prompt can state that the rejected patch was not applied, summarize the rejected operation, and tell the model not to repeat the same value.
- Repair patches may address existing array entries by stable id through virtual JSON Pointer segments such as `/parts/byId/deck-truss/visuals/byId/deck-panel/transform/position`. The harness resolves those ids against the current candidate before applying ordinary JSON Patch semantics. This reduces stale array-index repair failures while preserving local schema validation of the patched asset.
- Patch-application feedback can include targeted path hints for common schema/path mismatches. For example, if a repair writes `position`, `rotation`, or `scale` into `joint.limits`, the next prompt explicitly points to `joint.origin` and restates that limits only accept motion bounds.
- Gemini repair mode is transport-simplified on purpose. The shared loop still expects the canonical `{ "patch": [...] }` repair envelope, but `geminiManifestClient.ts` asks Gemini for `op`, `path`, and JSON-stringified `valueJson` fields, then parses those values back into canonical patch operations before returning. This avoids sending Gemini the huge central patch-value schema during repair, where structured output can fail with schema-complexity `400 INVALID_ARGUMENT` errors, while preserving local canonical validation of the fully patched asset.

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

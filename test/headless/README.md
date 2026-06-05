# Headless Agent Pipeline Smoke

Run the real create pipeline without the browser UI:

```sh
npm run test:headless
```

The smoke route uses the selected provider key from the environment or the
project `.env` file. It runs the real prompt compiler, shared app provider
factory, agent session/repair loop, validation harness, scene commit, and
in-memory asset library save.

Artifacts are written to `test/headless/artifacts/headless-agent/<run-id>/` by
default and are ignored by git. Each run captures:

- compiled system and user prompts
- model response text and parsed create/edit/repair tool-call JSON
- validation reports and signals for every attempt
- semantic failure clusters and deterministic probe reports for buildable attempts
- agent events, final scene, saved in-memory library, and summary JSON
- live progress in `progress.jsonl`
- per-attempt static GLB exports whenever an attempt can be parsed and exported
- per-attempt dynamic GLB exports when the attempt has movable joints or material emission animation
- final static GLB export for ready runs
- final dynamic GLB export for ready runs with movable joints or material emission animation
- viewer URLs for `test/headless/glb_viewer.html`

Useful overrides:

```sh
HEADLESS_AGENT_PROMPT='a hinged toolbox with opening lid' npm run test:headless
HEADLESS_AGENT_PROMPT='a compact espresso machine based on the reference' HEADLESS_AGENT_IMAGE_PATHS=tmp/reference.png npm run test:headless
HEADLESS_AGENT_PROVIDER=gemini npm run test:headless
HEADLESS_AGENT_PROVIDER=openrouter npm run test:headless
HEADLESS_AGENT_PROVIDER=openrouter HEADLESS_OPENROUTER_MODEL_ID=minimax/minimax-m3 npm run test:headless
HEADLESS_AGENT_PROVIDER=openrouter HEADLESS_OPENROUTER_MODEL_ID=moonshotai/kimi-k2.6 npm run test:headless
HEADLESS_AGENT_RUN_MODE=initial HEADLESS_AGENT_PROVIDER=openrouter npm run test:headless
HEADLESS_AGENT_RUN_MODE=repair HEADLESS_AGENT_PROVIDER=openrouter HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH=test/headless/artifacts/headless-agent/<run-id>/attempts/01/candidate.json npm run test:headless
HEADLESS_AGENT_EXPECT_READY=0 npm run test:headless
HEADLESS_AGENT_MAX_REPAIR_TURNS=10 npm run test:headless
HEADLESS_AGENT_REPEATED_FAILURE_STOP_STREAK=0 npm run test:headless
HEADLESS_AGENT_PATCH_ERROR_STOP_STREAK=0 npm run test:headless
HEADLESS_AGENT_ARTIFACT_DIR=test/headless/artifacts/headless-agent npm run test:headless
```

`HEADLESS_AGENT_RUN_TIMEOUT_MS` aborts the agent run through the same signal path
used by the UI. `HEADLESS_AGENT_TIMEOUT_MS` controls the outer Vitest timeout
and defaults to one minute longer than the agent-run timeout.
`HEADLESS_AGENT_RUN_MODE` controls how much of the pipeline the harness runs.
`full` is the default and runs a normal create attempt plus automatic repair
turns. `initial` runs only the first create attempt with zero repairs and does
not expect readiness unless `HEADLESS_AGENT_EXPECT_READY=1` is set. `repair`
seeds exchange 1 from `HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH`, validates
that previous candidate, and sends exactly one live provider repair request.
Providing `HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH` without a run mode also
infers `repair`; explicit `full` or `initial` modes reject seed paths.
`HEADLESS_AGENT_PROVIDER` selects the provider for the run and defaults to
OpenAI. OpenAI, Gemini, and OpenRouter use the same provider factory used by
the app. `openrouter` uses OpenRouter's normalized Chat Completions API with
default model `openai/gpt-5.5`, reasoning effort `high`, model-compatible JSON
response formatting, throughput-sorted provider routing, app attribution
headers, sticky `session_id` routing, and `OPENROUTER_API_KEY` from the
environment or `.env`.
OpenRouter response ids are captured for traceability, but the harness keeps
repair/edit context client-side because OpenRouter does not provide the same
server-side continuation path as OpenAI Responses or Gemini Interactions.
Set `HEADLESS_AGENT_MODEL_ID` / `HEADLESS_AGENT_REASONING_EFFORT` for a
provider-agnostic model override, or provider-specific variants such as
`HEADLESS_OPENROUTER_MODEL_ID` and `HEADLESS_OPENROUTER_REASONING_EFFORT`.
Gemini uses the Interactions API and reads
`GEMINI_API_KEY`, `GOOGLE_API_KEY`, or legacy Vite-prefixed variants from the
environment or `.env`.
`HEADLESS_AGENT_IMAGE_PATH` or comma-separated `HEADLESS_AGENT_IMAGE_PATHS`
loads local PNG/JPEG/WEBP/GIF files as reference image attachments and copies
them into each run's `reference-images/` artifact folder.
`HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH` should point at a previous
`attempts/NN/candidate.json` artifact when running repair mode. Set
`HEADLESS_AGENT_PROMPT` if the saved candidate's own `prompt` field is missing
or not the prompt you want replayed.
`HEADLESS_AGENT_PROGRESS_INTERVAL_MS` controls how often long model requests
print a live waiting heartbeat and defaults to 30 seconds.
The default agent-run timeout is one hour so stress runs can behave like real
pipeline runs; recent live runs completed in roughly 12-15 minutes but need
enough margin for slower repair turns.
The default headless repair cap is ten repair turns for diagnostic control.
The app runtime does not apply an implicit fixed repair cap; it relies on run
timeout, no-progress stops, context continuation, and user cancellation.
Headless also has a diagnostic-only repeated-failure stop that returns a failed
result before another model request once the same validation failure signature
repeats three times. Set `HEADLESS_AGENT_REPEATED_FAILURE_STOP_STREAK=0` to let
the run spend the full app repair cap.
Headless also stops before the next model request after two consecutive
patch-application errors by default, because consecutive schema-invalid repair
patches usually indicate a feedback/contract problem worth inspecting with
seeded repair replay. Set `HEADLESS_AGENT_PATCH_ERROR_STOP_STREAK=0` to disable
this headless-only stop.

To inspect a GLB artifact, serve the headless directory and open the viewer URL
recorded in `summary.json`:

```sh
cd test/headless && python -m http.server 3000
```
